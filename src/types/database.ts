// Database types kept in sync with supabase/migrations.
// Regenerate with supabase gen types once the project is linked to Supabase.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "admin" | "customer";
export type Currency = "BRL" | "USD";
export type OrderStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type OrderImageKind = "source" | "result";
export type RevisionStatus = "requested" | "in_progress" | "completed";
export type PaymentProviderId = "stripe" | "mercadopago" | "nowpayments" | "mock";
export type PaymentStatus = "pending" | "processing" | "paid" | "failed" | "refunded";
export type CommissionStatus = "pending" | "paid";

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};
export type ProfileInsert = {
  id: string;
  email: string;
  full_name?: string | null;
  role?: UserRole;
};
export type ProfileUpdate = {
  email?: string;
  full_name?: string | null;
  role?: UserRole;
};

export type PlanRow = {
  id: string;
  angles: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};
export type PlanInsert = {
  id?: string;
  angles: number;
  active?: boolean;
};
export type PlanUpdate = {
  angles?: number;
  active?: boolean;
};

export type PlanPriceRow = {
  id: string;
  plan_id: string;
  currency: Currency;
  amount_cents: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
};
export type PlanPriceInsert = {
  id?: string;
  plan_id: string;
  currency: Currency;
  amount_cents: number;
  valid_from?: string;
  valid_until?: string | null;
  active?: boolean;
};
export type PlanPriceUpdate = {
  amount_cents?: number;
  valid_until?: string | null;
  active?: boolean;
};

export type OrderRow = {
  id: string;
  user_id: string;
  plan_id: string | null;
  knife_quantity: number;
  total_images: number;
  currency: Currency;
  unit_price_cents: number;
  subtotal_cents: number;
  total_cents: number;
  status: OrderStatus;
  promised_delivery_date: string | null;
  production_ready_at: string | null;
  affiliate_id: string | null;
  paid_at: string | null;
  source_image_count: number;
  required_source_photos_per_knife: number;
  max_source_photos_per_knife: number;
  max_source_photo_size_mb: number;
  source_photos_submitted_at: string | null;
  idempotency_key: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type OrderInsert = {
  id?: string;
  user_id: string;
  plan_id: string | null;
  knife_quantity: number;
  total_images: number;
  currency: Currency;
  unit_price_cents: number;
  subtotal_cents: number;
  total_cents: number;
  status?: OrderStatus;
  promised_delivery_date: string;
  affiliate_id?: string | null;
  paid_at?: string | null;
  source_image_count?: number;
  required_source_photos_per_knife?: number;
  max_source_photos_per_knife?: number;
  max_source_photo_size_mb?: number;
  source_photos_submitted_at?: string | null;
  idempotency_key?: string | null;
  notes?: string | null;
};
export type OrderUpdate = {
  status?: OrderStatus;
  notes?: string | null;
  paid_at?: string | null;
  source_image_count?: number;
  idempotency_key?: string | null;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  item_index: number;
  plan_id: string;
  knife_quantity: number;
  angles: number;
  unit_price_cents: number;
  subtotal_cents: number;
  total_images: number;
  knife_index_start: number;
  created_at: string;
};
export type OrderItemInsert = {
  id?: string;
  order_id: string;
  item_index: number;
  plan_id: string;
  knife_quantity: number;
  angles: number;
  unit_price_cents: number;
  subtotal_cents: number;
  total_images: number;
  knife_index_start: number;
};
export type OrderItemUpdate = {
  item_index?: number;
  knife_quantity?: number;
  angles?: number;
  unit_price_cents?: number;
  subtotal_cents?: number;
  total_images?: number;
  knife_index_start?: number;
};

export type OrderImageRow = {
  id: string;
  order_id: string;
  kind: OrderImageKind;
  knife_index: number | null;
  storage_path: string;
  original_filename: string | null;
  created_at: string;
};
export type OrderImageInsert = {
  id?: string;
  order_id: string;
  kind: OrderImageKind;
  knife_index?: number | null;
  storage_path: string;
  original_filename?: string | null;
};
export type OrderImageUpdate = {
  knife_index?: number | null;
  storage_path?: string;
};
export type OrderRevisionRow = {
  id: string;
  order_id: string;
  round: number;
  status: RevisionStatus;
  notes: string | null;
  created_at: string;
};
export type OrderRevisionInsert = {
  id?: string;
  order_id: string;
  round: number;
  status?: RevisionStatus;
  notes?: string | null;
};
export type OrderRevisionUpdate = {
  status?: RevisionStatus;
  notes?: string | null;
};

export type PortfolioItemRow = {
  id: string;
  title: string;
  description: string | null;
  before_storage_path: string | null;
  after_storage_path: string | null;
  image_storage_path: string | null;
  published: boolean;
  featured: boolean;
  sort_order: number;
  created_at: string;
};
export type PortfolioItemInsert = {
  id?: string;
  title: string;
  description?: string | null;
  before_storage_path?: string | null;
  after_storage_path?: string | null;
  image_storage_path?: string | null;
  published?: boolean;
  featured?: boolean;
  sort_order?: number;
};
export type PortfolioItemUpdate = {
  title?: string;
  description?: string | null;
  before_storage_path?: string | null;
  after_storage_path?: string | null;
  image_storage_path?: string | null;
  published?: boolean;
  featured?: boolean;
  sort_order?: number;
};

export type PaymentRow = {
  id: string;
  order_id: string;
  provider: PaymentProviderId;
  external_payment_id: string;
  provider_event_id: string | null;
  status: PaymentStatus;
  amount_cents: number;
  currency: Currency;
  raw_metadata: Json | null;
  created_at: string;
  updated_at: string;
};
export type PaymentInsert = {
  id?: string;
  order_id: string;
  provider: PaymentProviderId;
  external_payment_id: string;
  provider_event_id?: string | null;
  status?: PaymentStatus;
  amount_cents: number;
  currency: Currency;
  raw_metadata?: Json;
};
export type PaymentUpdate = {
  provider_event_id?: string | null;
  status?: PaymentStatus;
  raw_metadata?: Json;
};

export type PaymentEventRow = {
  id: string;
  provider: PaymentProviderId;
  provider_event_id: string;
  payload: Json;
  received_at: string;
  processed_at: string | null;
};
export type PaymentEventInsert = {
  id?: string;
  provider: PaymentProviderId;
  provider_event_id: string;
  payload: Json;
};
export type PaymentEventUpdate = {
  processed_at?: string | null;
};

export type AffiliateRow = {
  id: string;
  name: string;
  email: string | null;
  code: string;
  commission_rate_basis_points: number;
  active: boolean;
  created_at: string;
};
export type AffiliateInsert = {
  id?: string;
  name: string;
  email?: string | null;
  code: string;
  commission_rate_basis_points?: number;
  active?: boolean;
};
export type AffiliateUpdate = {
  name?: string;
  email?: string | null;
  commission_rate_basis_points?: number;
  active?: boolean;
};

export type AffiliateCommissionRow = {
  id: string;
  affiliate_id: string;
  order_id: string;
  commission_rate_basis_points: number;
  amount_cents: number;
  status: CommissionStatus;
  paid_at: string | null;
  created_at: string;
};
export type AffiliateCommissionInsert = {
  id?: string;
  affiliate_id: string;
  order_id: string;
  commission_rate_basis_points: number;
  amount_cents: number;
  status?: CommissionStatus;
};
export type AffiliateCommissionUpdate = {
  status?: CommissionStatus;
  paid_at?: string | null;
};

export type AppSettingRow = {
  id: number;
  daily_capacity: number;
  cutoff_time: string;
  timezone: string;
  min_source_photos_per_knife: number;
  max_source_photos_per_knife: number;
  max_source_photo_size_mb: number;
  updated_at: string;
};
// 0016: Stripe admin configuration. Metadata ONLY — secrets live in
// Supabase Vault (secret_key_secret_id / webhook_secret_id).
export type StripeConfigRow = {
  id: number;
  mode: "test" | "live";
  secret_key_secret_id: string | null;
  webhook_secret_id: string | null;
  secret_key_last4: string | null;
  webhook_configured: boolean;
  configured_at: string | null;
  last_webhook_verified_at: string | null;
  updated_at: string;
  updated_by: string | null;
};
export type AppSettingInsert = {
  id?: number;
  daily_capacity?: number;
  cutoff_time?: string;
  timezone?: string;
  min_source_photos_per_knife?: number;
  max_source_photos_per_knife?: number;
  max_source_photo_size_mb?: number;
};
export type AppSettingUpdate = {
  daily_capacity?: number;
  cutoff_time?: string;
  timezone?: string;
  min_source_photos_per_knife?: number;
  max_source_photos_per_knife?: number;
  max_source_photo_size_mb?: number;
};

export type EstimateDeliveryResult = {
  businessDaysAfterReady: number;
  currentBacklogImages: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: { Row: ProfileRow; Insert: ProfileInsert; Update: ProfileUpdate; Relationships: [] };
      plans: { Row: PlanRow; Insert: PlanInsert; Update: PlanUpdate; Relationships: [] };
      plan_prices: { Row: PlanPriceRow; Insert: PlanPriceInsert; Update: PlanPriceUpdate; Relationships: [] };
      orders: { Row: OrderRow; Insert: OrderInsert; Update: OrderUpdate; Relationships: [] };
      order_items: { Row: OrderItemRow; Insert: OrderItemInsert; Update: OrderItemUpdate; Relationships: [] };
      order_images: { Row: OrderImageRow; Insert: OrderImageInsert; Update: OrderImageUpdate; Relationships: [] };
      order_revisions: { Row: OrderRevisionRow; Insert: OrderRevisionInsert; Update: OrderRevisionUpdate; Relationships: [] };
      portfolio_items: { Row: PortfolioItemRow; Insert: PortfolioItemInsert; Update: PortfolioItemUpdate; Relationships: [] };
      payments: { Row: PaymentRow; Insert: PaymentInsert; Update: PaymentUpdate; Relationships: [] };
      payment_events: { Row: PaymentEventRow; Insert: PaymentEventInsert; Update: PaymentEventUpdate; Relationships: [] };
      affiliates: { Row: AffiliateRow; Insert: AffiliateInsert; Update: AffiliateUpdate; Relationships: [] };
      affiliate_commissions: { Row: AffiliateCommissionRow; Insert: AffiliateCommissionInsert; Update: AffiliateCommissionUpdate; Relationships: [] };
      app_settings: { Row: AppSettingRow; Insert: AppSettingInsert; Update: AppSettingUpdate; Relationships: [] };
      stripe_config: { Row: StripeConfigRow; Insert: Partial<StripeConfigRow>; Update: Partial<StripeConfigRow>; Relationships: [] };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_order: {
        Args: {
          p_plan_id: string;
          p_knife_quantity: number;
          p_currency: Currency;
          p_affiliate_code?: string;
          p_idempotency_key?: string;
        };
        Returns: OrderRow;
      };
      create_cart_order: {
        Args: {
          p_items: { plan_id: string; quantity: number }[];
          p_currency: Currency;
          p_affiliate_code?: string;
          p_idempotency_key?: string;
        };
        Returns: OrderRow;
      };
      estimate_delivery: {
        Args: { p_new_images: number };
        Returns: EstimateDeliveryResult;
      };
      record_payment_intent: {
        Args: {
          p_order_id: string;
          p_provider: PaymentProviderId;
          p_external_payment_id: string;
          p_amount_cents: number;
          p_currency: Currency;
        };
        Returns: PaymentRow;
      };
      record_payment_failure: {
        Args: {
          p_order_id: string;
          p_provider: PaymentProviderId;
          p_external_payment_id: string;
          p_provider_event_id: string;
        };
        Returns: PaymentRow;
      };
      confirm_order_payment: {
        Args: {
          p_order_id: string;
          p_provider: PaymentProviderId;
          p_external_payment_id: string;
          p_provider_event_id: string;
          p_amount_cents: number;
          p_currency: Currency;
        };
        Returns: OrderRow;
      };
      request_order_revision: {
        Args: { p_order_id: string; p_notes: string };
        Returns: OrderRevisionRow;
      };
      set_plan_price: {
        Args: { p_plan_id: string; p_currency: Currency; p_amount_cents: number };
        Returns: PlanPriceRow;
      };
      set_plan_active: {
        Args: { p_plan_id: string; p_active: boolean };
        Returns: PlanRow;
      };
      set_portfolio_featured: {
        Args: { target_id: string };
        Returns: undefined;
      };
      update_app_settings: {
        Args: {
          p_daily_capacity: number;
          p_cutoff_time: string;
          p_timezone: string;
          p_min_source_photos_per_knife?: number | null;
          p_max_source_photos_per_knife?: number | null;
          p_max_source_photo_size_mb?: number | null;
        };
        Returns: AppSettingRow;
      };
      get_stripe_runtime_config: {
        Args: Record<string, never>;
        Returns: { mode: "test" | "live"; secret_key: string; webhook_secret: string }[];
      };
      get_stripe_admin_status: {
        Args: Record<string, never>;
        Returns: {
          mode: "test" | "live";
          secret_key_configured: boolean;
          webhook_secret_configured: boolean;
          secret_key_last4: string | null;
          configured_at: string | null;
          updated_at: string;
          updated_by: string | null;
        }[];
      };
      update_stripe_config: {
        Args: {
          p_mode: "test" | "live";
          p_secret_key?: string | null;
          p_webhook_secret?: string | null;
          p_updated_by?: string | null;
        };
        Returns: void;
      };
      mark_stripe_webhook_verified: {
        Args: Record<string, never>;
        Returns: void;
      };
      register_source_image: {
        Args: {
          p_order_id: string;
          p_knife_index: number;
          p_storage_path: string;
          p_original_filename?: string | null;
        };
        Returns: OrderImageRow;
      };
      submit_source_photos: {
        Args: { p_order_id: string };
        Returns: OrderRow;
      };
      delete_source_image: {
        Args: { p_image_id: string };
        Returns: string;
      };
      set_order_status: {
        Args: { p_order_id: string; p_status: OrderStatus };
        Returns: OrderRow;
      };
    };
    Enums: {
      user_role: UserRole;
      currency: Currency;
      order_status: OrderStatus;
      order_image_kind: OrderImageKind;
      revision_status: RevisionStatus;
      payment_provider: PaymentProviderId;
      payment_status: PaymentStatus;
      commission_status: CommissionStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
