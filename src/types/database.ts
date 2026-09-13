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
};

export type TaskOccurrence = {
  id: string;
  task_id: string;
  household_id: string;
  due_date: string;
  assigned_to: string | null;
  assigned_team_id: string | null;
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
  status: "open" | "bought";
  added_by: string;
  bought_by: string | null;
  bought_at: string | null;
  created_at: string;
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

export type ChatMessage = {
  id: string;
  household_id: string;
  user_id: string;
  content: string;
  created_at: string;
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
  created_by: string;
  created_at: string;
};

export type ExpenseShare = {
  expense_id: string;
  user_id: string;
  share_cents: number;
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
