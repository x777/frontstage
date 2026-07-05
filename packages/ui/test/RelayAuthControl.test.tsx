import { render, screen, fireEvent } from "@testing-library/react";
import { RelayAuthControl } from "../src/editor/RelayAuthControl.js";

test("signed out: shows a Sign in button", () => {
  render(<RelayAuthControl user={null} onSignIn={() => {}} onOpenSettings={() => {}} />);
  expect(screen.getByTestId("relay-auth-signin").textContent).toBe("Sign in");
  expect(screen.queryByTestId("relay-auth-user")).not.toBeInTheDocument();
});

test("signed out: clicking Sign in opens a Google/GitHub dropdown", () => {
  render(<RelayAuthControl user={null} onSignIn={() => {}} onOpenSettings={() => {}} />);
  expect(screen.queryByTestId("relay-auth-signin-google")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("relay-auth-signin"));

  expect(screen.getByTestId("relay-auth-signin-google").textContent).toContain("Google");
  expect(screen.getByTestId("relay-auth-signin-github").textContent).toContain("GitHub");
});

test("signed out: picking Google calls onSignIn('google') and closes the menu", () => {
  const onSignIn = vi.fn();
  render(<RelayAuthControl user={null} onSignIn={onSignIn} onOpenSettings={() => {}} />);

  fireEvent.click(screen.getByTestId("relay-auth-signin"));
  fireEvent.click(screen.getByTestId("relay-auth-signin-google"));

  expect(onSignIn).toHaveBeenCalledWith("google");
  expect(screen.queryByTestId("relay-auth-signin-google")).not.toBeInTheDocument();
});

test("signed out: picking GitHub calls onSignIn('github')", () => {
  const onSignIn = vi.fn();
  render(<RelayAuthControl user={null} onSignIn={onSignIn} onOpenSettings={() => {}} />);

  fireEvent.click(screen.getByTestId("relay-auth-signin"));
  fireEvent.click(screen.getByTestId("relay-auth-signin-github"));

  expect(onSignIn).toHaveBeenCalledWith("github");
});

test("signed out: clicking outside the dropdown closes it without signing in", () => {
  const onSignIn = vi.fn();
  render(
    <div>
      <div data-testid="outside" />
      <RelayAuthControl user={null} onSignIn={onSignIn} onOpenSettings={() => {}} />
    </div>,
  );

  fireEvent.click(screen.getByTestId("relay-auth-signin"));
  expect(screen.getByTestId("relay-auth-signin-google")).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByTestId("outside"));
  expect(screen.queryByTestId("relay-auth-signin-google")).not.toBeInTheDocument();
  expect(onSignIn).not.toHaveBeenCalled();
});

test("signed in: shows the user's name instead of Sign in", () => {
  render(
    <RelayAuthControl
      user={{ name: "Ada Lovelace", provider: "google" }}
      onSignIn={() => {}}
      onOpenSettings={() => {}}
    />,
  );
  expect(screen.getByTestId("relay-auth-user").textContent).toBe("Ada Lovelace");
  expect(screen.queryByTestId("relay-auth-signin")).not.toBeInTheDocument();
});

test("signed in: clicking the user button calls onOpenSettings", () => {
  const onOpenSettings = vi.fn();
  render(
    <RelayAuthControl
      user={{ name: "Ada Lovelace", provider: "google" }}
      onSignIn={() => {}}
      onOpenSettings={onOpenSettings}
    />,
  );
  fireEvent.click(screen.getByTestId("relay-auth-user"));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});
