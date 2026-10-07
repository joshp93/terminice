import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { filterEntries, type MenuEntry } from "../lib/slashMenu";
import { SlashMenu, type SlashMenuProps } from "./SlashMenu";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

const ENTRIES: MenuEntry[] = [
  {
    id: "command:model",
    label: "/model",
    detail: "Choose the model for this session",
    hint: "sonnet",
    selected: false,
  },
  {
    id: "command:compact",
    label: "/compact",
    detail: "Summarise the conversation to free up context",
    hint: "",
    selected: false,
  },
  {
    id: "command:clear",
    label: "/clear",
    detail: "Start a new session with empty context",
    hint: "",
    selected: true,
  },
];

const menuProps = (overrides: Partial<SlashMenuProps> = {}): SlashMenuProps => ({
  entries: ENTRIES,
  highlight: 0,
  parentLabel: null,
  placeAbove: true,
  onHighlight: vi.fn(),
  onChoose: vi.fn(),
  ...overrides,
});

describe("SlashMenu", () => {
  it("renders every entry it is given as an option", () => {
    render(<SlashMenu {...menuProps()} />);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("/model");
    expect(options[1]).toHaveTextContent("/compact");
    expect(options[2]).toHaveTextContent("/clear");
  });

  it("shows each entry's detail and argument hint", () => {
    render(<SlashMenu {...menuProps()} />);

    expect(screen.getByText("Choose the model for this session")).toBeInTheDocument();
    expect(screen.getByText("sonnet")).toBeInTheDocument();
    expect(screen.getByText("Summarise the conversation to free up context")).toBeInTheDocument();
  });

  it("marks the entry that is already in force", () => {
    render(<SlashMenu {...menuProps()} />);

    const clear = screen.getByRole("option", { name: /\/clear/ });
    expect(clear).toHaveTextContent("current");
    expect(screen.getByRole("option", { name: /\/model/ })).not.toHaveTextContent("current");
  });

  it("says so when nothing matches", () => {
    render(<SlashMenu {...menuProps({ entries: [] })} />);

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matching command")).toBeInTheDocument();
  });

  it("selects the row the parent highlights", () => {
    render(<SlashMenu {...menuProps({ highlight: 1 })} />);

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveClass("slash-item", "active");
    expect(options[0]).toHaveClass("slash-item");
    expect(options[0]).not.toHaveClass("active");
  });

  it("moves the selection when the parent moves the highlight", () => {
    const { rerender } = render(<SlashMenu {...menuProps({ highlight: 0 })} />);

    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    rerender(<SlashMenu {...menuProps({ highlight: 2 })} />);

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(options[2]).toHaveClass("slash-item", "active");
  });

  it("reports the entry that was chosen", async () => {
    const onChoose = vi.fn();
    render(<SlashMenu {...menuProps({ onChoose })} />);

    await userEvent.click(screen.getByRole("option", { name: /\/compact/ }));

    expect(onChoose).toHaveBeenCalledWith(ENTRIES[1]);
  });

  it("shows only the entries a query leaves, in the order it ranks them", () => {
    render(<SlashMenu {...menuProps({ entries: filterEntries(ENTRIES, "com") })} />);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("/compact");
  });

  it("lists everything again once the query is cleared", () => {
    const { rerender } = render(
      <SlashMenu {...menuProps({ entries: filterEntries(ENTRIES, "clear") })} />,
    );

    expect(screen.getAllByRole("option")).toHaveLength(1);

    rerender(<SlashMenu {...menuProps({ entries: filterEntries(ENTRIES, "") })} />);

    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("shows the parent label and a way back when a submenu is open", () => {
    render(<SlashMenu {...menuProps({ parentLabel: "Permission mode" })} />);

    expect(screen.getByText("Permission mode")).toBeInTheDocument();
    expect(screen.getByText("esc to go back")).toBeInTheDocument();
  });

  it("hides the submenu header at the root", () => {
    render(<SlashMenu {...menuProps()} />);

    expect(screen.queryByText("esc to go back")).not.toBeInTheDocument();
  });

  it("places itself above the anchor when asked, and below otherwise", () => {
    const { rerender } = render(<SlashMenu {...menuProps({ placeAbove: true })} />);

    expect(screen.getByRole("listbox")).toHaveClass("slash-menu", "above");

    rerender(<SlashMenu {...menuProps({ placeAbove: false })} />);

    expect(screen.getByRole("listbox")).toHaveClass("slash-menu", "below");
  });

  it("reports the row a genuinely moved pointer lands on", () => {
    const onHighlight = vi.fn();
    render(<SlashMenu {...menuProps({ onHighlight })} />);

    fireEvent.mouseMove(screen.getAllByRole("option")[2], { clientX: 40, clientY: 40 });

    expect(onHighlight).toHaveBeenCalledWith(2);
  });

  it("ignores a pointer that has barely moved, so it cannot steal the keyboard selection", () => {
    const onHighlight = vi.fn();
    render(<SlashMenu {...menuProps({ onHighlight })} />);

    fireEvent.mouseMove(screen.getAllByRole("option")[0], { clientX: 40, clientY: 40 });
    expect(onHighlight).toHaveBeenCalledWith(0);
    onHighlight.mockClear();

    fireEvent.mouseMove(screen.getAllByRole("option")[1], { clientX: 41, clientY: 41 });

    expect(onHighlight).not.toHaveBeenCalled();
  });

  it("reports a row again only once the pointer has moved far enough", () => {
    const onHighlight = vi.fn();
    render(<SlashMenu {...menuProps({ onHighlight })} />);

    fireEvent.mouseMove(screen.getAllByRole("option")[0], { clientX: 10, clientY: 10 });
    onHighlight.mockClear();

    fireEvent.mouseMove(screen.getAllByRole("option")[1], { clientX: 14, clientY: 10 });

    expect(onHighlight).toHaveBeenCalledWith(1);
  });
});
