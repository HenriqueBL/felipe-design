import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrderRow, OrderStatus } from "@/types/database";

export interface OrderWithCustomer extends OrderRow {
  customer_email: string | null;
}

async function fetchCustomerEmails(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", userIds);

  if (error) {
    throw new Error("Failed to load customers: " + error.message);
  }

  const emails = new Map<string, string>();
  for (const profile of data ?? []) {
    emails.set(profile.id, profile.email);
  }
  return emails;
}

export async function listOrders(limit = 50): Promise<OrderWithCustomer[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error("Failed to list orders: " + error.message);
  }

  const orders = data ?? [];
  const emails = await fetchCustomerEmails(orders.map((order) => order.user_id));

  return orders.map((order) => ({
    ...order,
    customer_email: emails.get(order.user_id) ?? null,
  }));
}

export async function getOrderById(orderId: string): Promise<OrderWithCustomer | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load order: " + error.message);
  }
  if (!data) {
    return null;
  }

  const emails = await fetchCustomerEmails([data.user_id]);
  return {
    ...data,
    customer_email: emails.get(data.user_id) ?? null,
  };
}

export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<OrderRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_order_status", {
    p_order_id: orderId,
    p_status: status,
  });

  if (error) {
    throw new Error("Failed to update order status: " + error.message);
  }
  return data;
}

export interface OrderCounts {
  pending: number;
  inProgress: number;
  completed: number;
  backlogImages: number;
}

export async function getOrderCounts(): Promise<OrderCounts> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("status, total_images");

  if (error) {
    throw new Error("Failed to count orders: " + error.message);
  }

  const counts: OrderCounts = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    backlogImages: 0,
  };

  for (const row of data ?? []) {
    if (row.status === "pending") {
      counts.pending += 1;
      counts.backlogImages += row.total_images;
    } else if (row.status === "in_progress") {
      counts.inProgress += 1;
      counts.backlogImages += row.total_images;
    } else if (row.status === "completed") {
      counts.completed += 1;
    }
  }

  return counts;
}
