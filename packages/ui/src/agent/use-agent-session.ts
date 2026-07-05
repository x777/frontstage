import { useState, useEffect } from "react";
import type { AgentSession, AgentSessionState } from "@frontstage/ai";

export function useAgentSession(session: AgentSession): AgentSessionState {
  const [s, setS] = useState(() => session.getState());
  useEffect(() => {
    setS(session.getState());
    return session.subscribe(() => setS(session.getState()));
  }, [session]);
  return s;
}
