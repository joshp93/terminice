//! Incremental UTF-8 decoding for chunked byte streams.

/// Decodes a byte stream into complete UTF-8 strings.
///
/// Bytes that form an incomplete trailing character are held back until a
/// later call, so multi-byte characters split across reads are never corrupted.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    /// Appends `chunk` and returns every complete character now available.
    ///
    /// Incomplete trailing sequences are retained for the next call. Bytes that
    /// can never form valid UTF-8 are replaced with U+FFFD.
    pub fn push(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut decoded = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    decoded.push_str(text);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    match error.error_len() {
                        Some(invalid) => {
                            let consumed = valid + invalid;
                            decoded.push_str(&String::from_utf8_lossy(&self.pending[..consumed]));
                            self.pending.drain(..consumed);
                        }
                        None => {
                            decoded.push_str(&String::from_utf8_lossy(&self.pending[..valid]));
                            self.pending.drain(..valid);
                            break;
                        }
                    }
                }
            }
        }
        decoded
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8Stream;

    #[test]
    fn passes_through_ascii() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.push(b"hello"), "hello");
    }

    #[test]
    fn holds_back_a_split_character() {
        let mut stream = Utf8Stream::default();
        let bytes = "é".as_bytes();
        assert_eq!(stream.push(&bytes[..1]), "");
        assert_eq!(stream.push(&bytes[1..]), "é");
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.push(&[0x41, 0xff, 0x42]), "A\u{fffd}B");
    }

    #[test]
    fn keeps_text_after_an_invalid_byte() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.push(&[0xff, 0x41]), "\u{fffd}A");
    }
}
