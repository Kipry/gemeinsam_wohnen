export type AssignmentMode = "anyone" | "rotation_member" | "rotation_team" | "fixed";

export type Profile = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type HouseholdMember = {
  household_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
};

export type Team = {
  id: string;
  household_id: string;
  name: string;
  created_at: string;
};

export type TeamMember = {
  team_id: string;
  user_id: string;
};

export type Task = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  points: number;
  interval_days: number;
  assignment_mode: AssignmentMode;
  fixed_assignee: string | null;
  skip_absent: boolean;
  /** Fester Wochentag (0=Sonntag .. 6=Samstag), null = kein Anker */
  weekday: number | null;
  current_position: number | null;
  active: boolean;
  created_by: string;
  created_at: string;
};

export type TaskRotationEntry = {
  id: string;
  task_id: string;
  position: number;
  user_id: string | null;
  team_id: string | null;
  placeholder_id: string | null;
};

/** Mitbewohner, der noch nicht beigetreten ist, aber schon im Putzplan steht */
export type HouseholdPlaceholder = {
  id: string;
  household_id: string;
  name: string;
  claimed_by: string | null;
  claimed_at: string | null;
  created_by: string;
  created_at: string;
};

export type TaskOccurrence = {
  id: string;
  task_id: string;
  household_id: string;
  due_date: string;
  assigned_to: string | null;
  assigned_team_id: string | null;
  assigned_placeholder_id: string | null;
  rotation_position: number | null;
  status: "open" | "done" | "skipped";
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
};

export type ShoppingItem = {
  id: string;
  household_id: string;
  name: string;
  quantity: string | null;
  category: string | null;
  status: "open" | "bought";
  added_by: string;
  bought_by: string | null;
  bought_at: string | null;
  trip_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type ShoppingTrip = {
  id: string;
  household_id: string;
  shopper: string;
  store: string | null;
  started_at: string;
  finished_at: string | null;
  total_cents: number | null;
  expense_id: string | null;
};

export type Absence = {
  id: string;
  household_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  note: string | null;
  created_at: string;
};

export type EventKind = "termin" | "wg_abend" | "besuch" | "handwerker" | "geburtstag";

export type CalendarEvent = {
  id: string;
  household_id: string;
  kind: EventKind;
  title: string;
  note: string | null;
  starts_on: string;
  ends_on: string;
  /** null = ganztägig */
  start_time: string | null;
  end_time: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
};

export type CalendarEventAttendee = {
  event_id: string;
  user_id: string;
  status: "yes" | "no";
  responded_at: string;
};

export type ChatKind = "message" | "event" | "announcement" | "request";

export type ChatMessage = {
  id: string;
  household_id: string;
  user_id: string;
  content: string;
  kind: ChatKind;
  ref_table: string | null;
  ref_id: string | null;
  reply_to: string | null;
  /** Aushang klebt oben bis zu diesem Tag */
  pinned_until: string | null;
  claimed_by: string | null;
  done_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type ChatReceipt = {
  message_id: string;
  user_id: string;
  read_at: string;
};

export type Expense = {
  id: string;
  household_id: string;
  title: string;
  amount_cents: number;
  currency: string;
  paid_by: string;
  expense_date: string;
  note: string | null;
  category: string | null;
  split_mode: "equal" | "amounts" | "weights";
  created_by: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
};

export type ExpenseShare = {
  expense_id: string;
  user_id: string;
  share_cents: number;
  weight: number | null;
};

export type RecurringExpense = {
  id: string;
  household_id: string;
  title: string;
  amount_cents: number;
  paid_by: string;
  day_of_month: number;
  category: string | null;
  split_mode: "equal" | "amounts" | "weights";
  active: boolean;
  last_booked_on: string | null;
  created_by: string;
  created_at: string;
};

export type Settlement = {
  id: string;
  household_id: string;
  from_user: string;
  to_user: string;
  amount_cents: number;
  note: string | null;
  settled_at: string;
  created_by: string;
};

export type ChoreStats = {
  household_id: string;
  user_id: string;
  tasks_done: number;
  points_done: number;
  done_on_time: number;
  open_assigned: number;
  overdue_assigned: number;
};

export type ExpenseBalance = {
  household_id: string;
  user_id: string;
  paid_cents: number;
  owed_cents: number;
  net_cents: number;
};
