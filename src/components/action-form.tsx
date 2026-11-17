"use client";

import { useActionState } from "react";

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<{ error?: string; ok?: string } | void>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(async (_prev: { error?: string; ok?: string } | null, formData: FormData) => {
    const result = await action(formData);
    return result || null;
  }, null);
  return (
    <form action={formAction} className={className}>
      {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state?.ok ? <p className="flash">{state.ok}</p> : null}
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
        {children}
      </fieldset>
    </form>
  );
}
