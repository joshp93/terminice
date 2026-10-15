//! The colour the window wears, so two instances can be told apart.

use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// How many colours there are to hand out.
const PALETTE: usize = 16;

/// The first loopback port a claim is made on; one port per colour.
const FIRST_PORT: u16 = 49_731;

/// The colours this process has claimed, held open for as long as it lives.
///
/// The listener is the claim. Binding a loopback port is atomic across
/// processes and the operating system releases it the moment the process ends,
/// which is what makes this self-healing: an instance that is killed rather
/// than closed leaves nothing behind to be cleaned up, and an instance that
/// starts afterwards finds that colour free again.
#[derive(Default)]
pub struct WindowColours(Mutex<Vec<(usize, TcpListener)>>);

/// Where in the palette this process starts looking.
///
/// A random start rather than the first free colour, so the colour an instance
/// wears is not a queue number: two instances started a day apart are as likely
/// to match as two started together, and which one is which is not something a
/// reader can infer.
///
/// Both terms are multiplied through a large constant and a high part of the
/// word is taken, rather than a remainder of it. A remainder keeps only the low
/// four bits of the clock, and a clock with a coarse resolution — a 15.6ms tick
/// makes `subsec_nanos` a multiple of 15,625,000, whose low four bits take two
/// values — leaves those bits nearly constant and the whole choice resting on
/// the process id, which Windows reuses. Measured on this machine: the clock is
/// fine and the simple form spread evenly over 400 simulated launches, so this
/// is the form that cannot degenerate rather than a repair for anything seen.
fn starting_point() -> usize {
    const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::from(elapsed.subsec_nanos()))
        .unwrap_or(0);
    let mixed =
        nanos.wrapping_mul(GOLDEN) ^ u64::from(std::process::id()).wrapping_mul(GOLDEN >> 1);
    ((mixed >> 32) % PALETTE as u64) as usize
}

/// Claims a colour, from `start` onwards, wrapping once.
///
/// The colour already held is handed back rather than a second one being taken,
/// so asking twice — a reload, a second call from the frontend — does not eat a
/// colour the window is not wearing.
///
/// `first_port` is where the palette's ports begin. It is fixed for the process
/// by the command below, and a parameter only so that a test can claim in a
/// range no other test is using: the ports are the claim, so two tests claiming
/// in the same range would be testing each other's claims.
///
/// # Returns
///
/// The index of the colour claimed, or none when every one of them is taken.
fn claim(held: &Mutex<Vec<(usize, TcpListener)>>, first_port: u16, start: usize) -> Option<usize> {
    let mut held = held.lock().ok()?;

    if let Some((index, _)) = held.first() {
        return Some(*index);
    }

    for step in 0..PALETTE {
        let index = (start + step) % PALETTE;
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", first_port + index as u16)) {
            held.push((index, listener));
            return Some(index);
        }
    }

    None
}

/// Claims the colour this window should wear.
///
/// The frontend does the drawing; this only decides, because the decision is
/// the part that has to be made across processes.
#[tauri::command]
pub fn claim_window_colour(state: tauri::State<'_, WindowColours>) -> Option<usize> {
    claim(&state.0, FIRST_PORT, starting_point())
}

#[cfg(test)]
mod tests {
    use super::{claim, PALETTE};
    use std::net::TcpListener;
    use std::sync::Mutex;

    /// Where a test's own palette of ports begins.
    ///
    /// Tests share a process, so they share the ports: each one claims in a
    /// range of its own, spaced further apart than the palette is long.
    fn base_for(test: u16) -> u16 {
        51_000 + test * 32
    }

    #[test]
    fn claims_a_colour() {
        let held = Mutex::new(Vec::new());
        assert!(claim(&held, base_for(0), 0).is_some());
    }

    /// Asking twice is not two windows: the colour already held comes back, so
    /// a reload does not consume a second one.
    #[test]
    fn hands_back_the_colour_it_already_holds() {
        let held = Mutex::new(Vec::new());
        let first = claim(&held, base_for(1), 4);
        assert_eq!(claim(&held, base_for(1), 0), first);
        assert_eq!(held.lock().expect("not poisoned").len(), 1);
    }

    /// Two instances starting at the same place still get different colours,
    /// because the second cannot bind a port the first is holding.
    #[test]
    fn a_second_instance_takes_a_different_colour() {
        let first = Mutex::new(Vec::new());
        let second = Mutex::new(Vec::new());
        let base = base_for(2);

        let taken = claim(&first, base, 0).expect("the first claim succeeds");
        let other = claim(&second, base, 0).expect("the second claim succeeds");

        assert_ne!(taken, other);
    }

    /// The search starts where it is told to, so the colour is not always the
    /// same one and is not always the lowest free one either.
    #[test]
    fn starts_looking_where_it_is_told_to() {
        let held = Mutex::new(Vec::new());
        assert_eq!(claim(&held, base_for(3), 9), Some(9));
    }

    /// A colour taken by something else — another instance, or any other
    /// program on the machine — is passed over rather than claimed twice.
    #[test]
    fn passes_over_a_colour_someone_else_is_holding() {
        let base = base_for(4);
        let elsewhere =
            TcpListener::bind(("127.0.0.1", base + 3)).expect("the port is free before the test");
        let held = Mutex::new(Vec::new());

        assert_eq!(claim(&held, base, 3), Some(4));

        drop(elsewhere);
    }

    /// Sixteen windows, one colour each, and no two of them alike; the
    /// seventeenth finds them all taken rather than sharing one.
    #[test]
    fn hands_every_colour_out_once() {
        let base = base_for(5);
        let mut windows = Vec::new();
        let mut claimed = Vec::new();

        for _ in 0..PALETTE {
            let window = Mutex::new(Vec::new());
            claimed.push(claim(&window, base, 0).expect("a colour is still free"));
            windows.push(window);
        }

        let distinct: std::collections::HashSet<usize> = claimed.iter().copied().collect();
        assert_eq!(distinct.len(), PALETTE);
        assert!(claimed.iter().all(|index| *index < PALETTE));

        let one_too_many = Mutex::new(Vec::new());
        assert_eq!(claim(&one_too_many, base, 0), None);
    }
}
