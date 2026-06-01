-- 008_follow_up_time.sql
-- Optional time-of-day for a follow-up.
--
-- The DATE (clients.follow_up_date) still decides whether something is "due
-- today" or overdue — this column never gates the due list, so a follow-up can
-- never "disappear" just because its time hasn't arrived. It's informational:
-- it shows on the card, orders the day's list, and can drive a timed reminder
-- later. Nullable — a follow-up with no specific time simply shows no time.

alter table clients add column if not exists follow_up_time time;
