import { useEffect, useState } from "react";
import { getActivePowerProfile } from "../backend";

const POLL_INTERVAL_MS = 3000;

// Polls the live active power profile so the Power tab stays correct when
// it is changed from elsewhere (Steam's performance panel) while this tab is
// open.
export function useActivePowerProfile(initial: string = ""): string {
  const [active, setActive] = useState(initial);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getActivePowerProfile();
        if (!cancelled) setActive(next);
      } catch {
        // Transient read failure -- skip this tick rather than surfacing an error.
      }
    };
    // Skip the immediate fetch when the caller already seeded a fresh value
    // (Power.tsx passes config.activePowerProfile); callers with no initial
    // (the title-bar badge) fetch right away instead of waiting a full tick.
    if (!initial) poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return active;
}
