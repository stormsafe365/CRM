// Calendar: full-page month calendar of every lead's follow-up. Reuses the same
// DashCalendar component the dashboard uses (month grid, flip months, day modal,
// ordered jobs color-coded, live-updates).

import DashCalendar from '../components/DashCalendar'

export default function Calendar() {
  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">Schedule</div>
          <h1>Calendar</h1>
          <div className="sub">Every lead’s follow-up by day — ordered jobs are color-coded. Click a day to see who’s due.</div>
        </div>
      </div>
      <DashCalendar />
    </>
  )
}
