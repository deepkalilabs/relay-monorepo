import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "@/shared/ui/modal";

afterEach(cleanup);

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <Modal open={open} title="Confirm action" onClose={() => setOpen(false)}>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button">Confirm</button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("traps keyboard focus and restores it to the invoker after close", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const invoker = screen.getByRole("button", { name: "Open dialog" });

    await user.click(invoker);
    const close = screen.getByRole("button", { name: "Close dialog" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoker).toHaveFocus();
  });
});
