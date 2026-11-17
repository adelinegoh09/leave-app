export function MonthCalendar({
  month,
  today,
  events,
}: {
  month: string;
  today: string;
  events: { date: string; title: string; kind: "holiday" | "leave" }[];
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const pad = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array(pad).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <div className="cal-scroll"><div className="cal" aria-label="Month calendar">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="dow">{day}</div>)}
      {cells.map((day, index) => {
        if (!day) return <div key={`e${index}`} className="day empty" />;
        const iso = `${month}-${String(day).padStart(2, "0")}`;
        const mine = events.filter((event) => event.date === iso);
        return (
          <div key={iso} className={iso === today ? "day today" : "day"}>
            <strong>{day}</strong>
            {mine.map((event) => <span key={event.title} className={event.kind === "holiday" ? "chip holiday" : "chip"}>{event.title}</span>)}
          </div>
        );
      })}
    </div></div>
  );
}
