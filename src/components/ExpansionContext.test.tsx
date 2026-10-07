import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { describe, expect, it } from "vitest";
import { type Expansion, ExpansionProvider, useExpansion } from "./ExpansionContext";

function Card({ id }: { id: string }) {
  const { isOpen, toggle } = useExpansion();

  return (
    <div>
      <button type="button" onClick={() => toggle(id)}>{`toggle ${id}`}</button>
      <span>{`${id} is ${isOpen(id) ? "open" : "closed"}`}</span>
    </div>
  );
}

function Harness({ ids }: { ids: string[] }) {
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [exceptions, setExceptions] = useState<ReadonlySet<string>>(new Set());

  const value = useMemo<Expansion>(
    () => ({
      isOpen: (id) => (exceptions.has(id) ? !defaultOpen : defaultOpen),
      toggle: (id) =>
        setExceptions((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [defaultOpen, exceptions],
  );

  return (
    <ExpansionProvider value={value}>
      <button
        type="button"
        onClick={() => {
          setDefaultOpen((current) => !current);
          setExceptions(new Set());
        }}
      >
        {defaultOpen ? "collapse all" : "expand all"}
      </button>
      {ids.map((id) => (
        <Card key={id} id={id} />
      ))}
    </ExpansionProvider>
  );
}

function Bare() {
  const { isOpen, toggle } = useExpansion();

  return (
    <button type="button" onClick={() => toggle("x")}>
      {isOpen("x") ? "open" : "closed"}
    </button>
  );
}

const toggleFor = (id: string) => screen.getByRole("button", { name: `toggle ${id}` });

describe("ExpansionContext", () => {
  it("reads as collapsed by default", () => {
    render(<Harness ids={["a", "b"]} />);
    expect(screen.getByText("a is closed")).toBeInTheDocument();
    expect(screen.getByText("b is closed")).toBeInTheDocument();
  });

  it("toggles one id without disturbing its neighbours", async () => {
    const user = userEvent.setup();
    render(<Harness ids={["a", "b"]} />);

    await user.click(toggleFor("a"));

    expect(screen.getByText("a is open")).toBeInTheDocument();
    expect(screen.getByText("b is closed")).toBeInTheDocument();
  });

  it("returns an id to the default when toggled twice", async () => {
    const user = userEvent.setup();
    render(<Harness ids={["a"]} />);

    await user.click(toggleFor("a"));
    await user.click(toggleFor("a"));

    expect(screen.getByText("a is closed")).toBeInTheDocument();
  });

  it("opens every id when the default is turned on", async () => {
    const user = userEvent.setup();
    render(<Harness ids={["a", "b"]} />);

    await user.click(screen.getByRole("button", { name: "expand all" }));

    expect(screen.getByText("a is open")).toBeInTheDocument();
    expect(screen.getByText("b is open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "collapse all" })).toBeInTheDocument();
  });

  it("covers an id that appears after the default was turned on", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness ids={["a", "b"]} />);

    await user.click(screen.getByRole("button", { name: "expand all" }));
    rerender(<Harness ids={["a", "b", "c"]} />);

    expect(screen.getByText("c is open")).toBeInTheDocument();
  });

  it("keeps an id the user closed out of an open default", async () => {
    const user = userEvent.setup();
    render(<Harness ids={["a", "b"]} />);

    await user.click(screen.getByRole("button", { name: "expand all" }));
    await user.click(toggleFor("b"));

    expect(screen.getByText("a is open")).toBeInTheDocument();
    expect(screen.getByText("b is closed")).toBeInTheDocument();
  });

  it("closes every id when the default is turned off", async () => {
    const user = userEvent.setup();
    render(<Harness ids={["a", "b"]} />);

    await user.click(screen.getByRole("button", { name: "expand all" }));
    await user.click(screen.getByRole("button", { name: "collapse all" }));

    expect(screen.getByText("a is closed")).toBeInTheDocument();
    expect(screen.getByText("b is closed")).toBeInTheDocument();
  });

  it("makes an id that appears after collapse all follow the closed default", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness ids={["a"]} />);

    await user.click(screen.getByRole("button", { name: "expand all" }));
    await user.click(screen.getByRole("button", { name: "collapse all" }));
    rerender(<Harness ids={["a", "b"]} />);

    expect(screen.getByText("b is closed")).toBeInTheDocument();
  });

  it("reads as collapsed and toggles nothing without a provider", async () => {
    const user = userEvent.setup();
    render(<Bare />);

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("closed");
    await user.click(button);
    expect(screen.getByRole("button")).toHaveTextContent("closed");
  });
});
