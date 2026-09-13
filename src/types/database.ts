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

export type Task = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  points: number;
  interval_days: number;
  active: boolean;
  created_by: string;
  created_at: string;
};

export type TaskOccurrence = {
  id: string;
  task_id: string;
  household_id: string;
  due_date: string;
  assigned_to: string | null;
  status: "open" | "done";
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

export type BalanceRow = {
  household_id: string;
  user_id: string;
  full_name: string;
  tasks_done: number;
  points_done: number;
};
