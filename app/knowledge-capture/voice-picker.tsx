"use client";

import { useState } from "react";
import type { Voice } from "@/lib/knowledge-capture/voices";

/** Who is talking in the next take — defaults to whoever is signed in. Never empty. */
export function useTalking(voices: Voice[], me: string) {
  const myVoice = voices.find((v) => v.email === me);
  const [talking, setTalking] = useState<string[]>(myVoice ? [myVoice.email] : []);
  const toggle = (email: string) =>
    setTalking((t) => (t.includes(email) ? (t.length > 1 ? t.filter((e) => e !== email) : t) : [...t, email]));
  return { talking, toggle };
}

/** "Whose knowledge?" chips. */
export function VoicePicker({ voices, talking, onToggle }: { voices: Voice[]; talking: string[]; onToggle: (email: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-charcoal-600">Whose knowledge?</span>
      {voices.map((v) => {
        const on = talking.includes(v.email);
        return (
          <button
            key={v.email}
            onClick={() => onToggle(v.email)}
            aria-pressed={on}
            className={`rounded-full px-3 py-1 ${on ? "bg-charcoal-800 text-white" : "bg-sand-100 text-charcoal-600 hover:bg-sand-200"}`}
          >
            {v.name}
          </button>
        );
      })}
      {talking.length > 1 && <span className="text-xs text-charcoal-500">Recording together — say names when you hand off.</span>}
    </div>
  );
}
