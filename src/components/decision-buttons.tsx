"use client";

export function DecisionButtons({ approveLabel, rejectLabel }: { approveLabel: string; rejectLabel: string }) {
  function choose(value: string) {
    return (event: React.MouseEvent<HTMLButtonElement>) => {
      const field = event.currentTarget.form?.querySelector<HTMLInputElement>('input[name="decision"]');
      if (field) field.value = value;
    };
  }
  return (
    <>
      <input type="hidden" name="decision" defaultValue="" />
      <div className="row" style={{ marginTop: "0.6rem" }}>
        <button className="btn primary" type="submit" onClick={choose("approve")}>{approveLabel}</button>
        <button className="btn" type="submit" onClick={choose("reject")}>{rejectLabel}</button>
      </div>
    </>
  );
}
