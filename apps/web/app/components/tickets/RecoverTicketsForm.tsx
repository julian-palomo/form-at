import { Button } from "@form-at/ui";
import { type FormEvent, useState } from "react";
import { recoverTickets } from "~/data/tickets";

// "Recover my tickets": an email field that asks the server to send the
// buyer's ticket links again. The answer on screen is the same whether or
// not the email bought anything, so the form can't be used to find out who
// did; the server limits how often it can be asked (`recoverTicketsFor`).

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "unavailable" };

export function RecoverTicketsForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const result = await recoverTickets({ data: { email } });
      setState({ kind: result.status === "ok" ? "sent" : "unavailable" });
    } catch {
      setState({ kind: "unavailable" });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm sm:text-base text-grey leading-relaxed">
        bought a ticket and don't have it here? enter the email you paid with and we'll send the
        links again.
      </p>
      <label className="flex flex-col gap-2 text-sm text-grey">
        <span>
          <span className="text-gold mr-2">›</span>email
        </span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-black border border-grey/40 focus:border-gold outline-none px-3 py-2 text-white font-mono"
        />
      </label>
      <div className="flex items-center gap-4">
        <Button variant="secondary" type="submit" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "sending…" : "send my tickets"}
        </Button>
      </div>
      {state.kind === "sent" && (
        <output className="block text-sm sm:text-base text-grey leading-relaxed">
          if that email bought tickets for an upcoming night, they're on their way again. check spam
          too.
        </output>
      )}
      {state.kind === "unavailable" && (
        <output className="block text-sm sm:text-base text-grey leading-relaxed">
          we can't send tickets right now. try again later, or write to us on instagram.
        </output>
      )}
    </form>
  );
}
