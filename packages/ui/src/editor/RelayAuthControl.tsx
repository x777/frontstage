import { useState, useRef, useEffect } from "react";
import { theme } from "../theme/theme.js";
import { Button, MenuList } from "../primitives/index.js";
import type { MenuListItem } from "../primitives/index.js";

export interface RelayAuthProps {
  user: { name: string; provider: string } | null;
  onSignIn: (provider: "google" | "github") => void;
  onOpenSettings: () => void;
}

const SIGNIN_ITEMS: MenuListItem[] = [
  { id: "google", label: "Sign in with Google", testid: "relay-auth-signin-google" },
  { id: "github", label: "Sign in with GitHub", testid: "relay-auth-signin-github" },
];

// Top-bar sign-in affordance (M18C T3) — signed out: "Sign in" opens a two-provider dropdown
// (the FileMenu pattern); signed in: the user's name as a quiet button that opens Settings, where
// the full account pane (logout, BYO keys) already lives.
export function RelayAuthControl({ user, onSignIn, onOpenSettings }: RelayAuthProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  if (user) {
    return (
      <Button
        testid="relay-auth-user"
        onClick={onOpenSettings}
        title={`Signed in with ${user.provider}`}
        style={{ background: "transparent", color: theme.text.tertiary }}
      >
        {user.name}
      </Button>
    );
  }

  function handleSelect(id: string) {
    setMenuOpen(false);
    onSignIn(id as "google" | "github");
  }

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <Button testid="relay-auth-signin" onClick={() => setMenuOpen((v) => !v)}>
        Sign in
      </Button>
      {menuOpen && (
        <div style={{ position: "absolute", top: `calc(100% + ${theme.spacing.xxs})`, right: 0, zIndex: theme.z.menu }}>
          <MenuList items={SIGNIN_ITEMS} onSelect={handleSelect} />
        </div>
      )}
    </div>
  );
}
