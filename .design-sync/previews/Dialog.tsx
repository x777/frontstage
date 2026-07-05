import { Button, Dialog } from "@frontstage/ui";

export const ConfirmDiscard = () => (
  <div style={{ background: "var(--bg-base)", width: 480, height: 300, position: "relative" }}>
    <Dialog
      title="Discard changes?"
      footer={
        <>
          <Button>Cancel</Button>
          <Button variant="destructive">Discard</Button>
        </>
      }
      onClose={() => {}}
    >
      Unsaved edits to Sunset Cut v3 will be lost.
    </Dialog>
  </div>
);
