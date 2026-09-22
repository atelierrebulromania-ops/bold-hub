export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          id: string
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          completed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          delivery_group_id: string | null
          id: string
          route_order: Json | null
          status: Database["public"]["Enums"]["delivery_status"]
          trigger_type: Database["public"]["Enums"]["delivery_trigger_type"]
          triggered_by_reseller_id: string | null
        }
        Insert: {
          completed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          delivery_group_id?: string | null
          id?: string
          route_order?: Json | null
          status?: Database["public"]["Enums"]["delivery_status"]
          trigger_type: Database["public"]["Enums"]["delivery_trigger_type"]
          triggered_by_reseller_id?: string | null
        }
        Update: {
          completed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          delivery_group_id?: string | null
          id?: string
          route_order?: Json | null
          status?: Database["public"]["Enums"]["delivery_status"]
          trigger_type?: Database["public"]["Enums"]["delivery_trigger_type"]
          triggered_by_reseller_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_triggered_by_reseller_id_fkey"
            columns: ["triggered_by_reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_carts: {
        Row: {
          cart_id: string
          delivery_id: string
        }
        Insert: {
          cart_id: string
          delivery_id: string
        }
        Update: {
          cart_id?: string
          delivery_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_carts_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: true
            referencedRelation: "reseller_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_carts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_groups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          message: string
          read_at: string | null
          recipient_reseller_id: string | null
          recipient_role: Database["public"]["Enums"]["user_role"] | null
          recipient_user_id: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          type: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          message: string
          read_at?: string | null
          recipient_reseller_id?: string | null
          recipient_role?: Database["public"]["Enums"]["user_role"] | null
          recipient_user_id?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          type: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          message?: string
          read_at?: string | null
          recipient_reseller_id?: string | null
          recipient_role?: Database["public"]["Enums"]["user_role"] | null
          recipient_user_id?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_reseller_id_fkey"
            columns: ["recipient_reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      online_order_items: {
        Row: {
          created_at: string
          ean: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          scanned_quantity: number
        }
        Insert: {
          created_at?: string
          ean: string
          id?: string
          order_id: string
          product_id: string
          quantity: number
          scanned_quantity?: number
        }
        Update: {
          created_at?: string
          ean?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          scanned_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "online_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      online_orders: {
        Row: {
          bocp_order_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          courier_type: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          invoice_number: string
          invoice_pdf_url: string | null
          released_at: string | null
          shipping_address: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["online_order_status"]
        }
        Insert: {
          bocp_order_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          courier_type?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          invoice_number: string
          invoice_pdf_url?: string | null
          released_at?: string | null
          shipping_address?: string | null
          source: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["online_order_status"]
        }
        Update: {
          bocp_order_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          courier_type?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          invoice_number?: string
          invoice_pdf_url?: string | null
          released_at?: string | null
          shipping_address?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["online_order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "online_orders_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_returns: {
        Row: {
          id: string
          online_order_id: string
          reason: Database["public"]["Enums"]["return_reason"]
          registered_at: string
          registered_by: string | null
          shopify_marked_manually: boolean
          status: Database["public"]["Enums"]["return_status"]
        }
        Insert: {
          id?: string
          online_order_id: string
          reason?: Database["public"]["Enums"]["return_reason"]
          registered_at?: string
          registered_by?: string | null
          shopify_marked_manually?: boolean
          status?: Database["public"]["Enums"]["return_status"]
        }
        Update: {
          id?: string
          online_order_id?: string
          reason?: Database["public"]["Enums"]["return_reason"]
          registered_at?: string
          registered_by?: string | null
          shopify_marked_manually?: boolean
          status?: Database["public"]["Enums"]["return_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_returns_online_order_id_fkey"
            columns: ["online_order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_returns_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          bocp_product_id: string | null
          category: string | null
          created_at: string
          ean: string | null
          id: string
          image_url: string | null
          name: string
          sku: string
          synced_at: string | null
          variant_label: string | null
        }
        Insert: {
          active?: boolean
          bocp_product_id?: string | null
          category?: string | null
          created_at?: string
          ean?: string | null
          id?: string
          image_url?: string | null
          name: string
          sku: string
          synced_at?: string | null
          variant_label?: string | null
        }
        Update: {
          active?: boolean
          bocp_product_id?: string | null
          category?: string | null
          created_at?: string
          ean?: string | null
          id?: string
          image_url?: string | null
          name?: string
          sku?: string
          synced_at?: string | null
          variant_label?: string | null
        }
        Relationships: []
      }
      refill_requests: {
        Row: {
          ai_confidence: number | null
          ai_matched_product_id: string | null
          ai_read_label_text: string | null
          cart_item_id: string | null
          confirmed_at: string | null
          created_at: string
          id: string
          image_url: string | null
          phone_number: string | null
          quantity: number | null
          raw_text: string | null
          reseller_id: string | null
          source: string
          status: Database["public"]["Enums"]["refill_request_status"]
        }
        Insert: {
          ai_confidence?: number | null
          ai_matched_product_id?: string | null
          ai_read_label_text?: string | null
          cart_item_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          phone_number?: string | null
          quantity?: number | null
          raw_text?: string | null
          reseller_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["refill_request_status"]
        }
        Update: {
          ai_confidence?: number | null
          ai_matched_product_id?: string | null
          ai_read_label_text?: string | null
          cart_item_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          phone_number?: string | null
          quantity?: number | null
          raw_text?: string | null
          reseller_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["refill_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "refill_request_cart_item_fk"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "reseller_cart_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refill_requests_ai_matched_product_id_fkey"
            columns: ["ai_matched_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refill_requests_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      reseller_cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          product_id: string
          quantity_needed: number
          refill_request_id: string | null
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          product_id: string
          quantity_needed: number
          refill_request_id?: string | null
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          product_id?: string
          quantity_needed?: number
          refill_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reseller_cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "reseller_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reseller_cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reseller_cart_items_refill_request_id_fkey"
            columns: ["refill_request_id"]
            isOneToOne: true
            referencedRelation: "refill_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      reseller_carts: {
        Row: {
          countdown_started_at: string | null
          created_at: string
          delivered_at: string | null
          id: string
          reseller_id: string
          status: Database["public"]["Enums"]["cart_status"]
        }
        Insert: {
          countdown_started_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          reseller_id: string
          status?: Database["public"]["Enums"]["cart_status"]
        }
        Update: {
          countdown_started_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          reseller_id?: string
          status?: Database["public"]["Enums"]["cart_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reseller_carts_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      reseller_companies: {
        Row: {
          company_name: string
          created_at: string
          id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          id?: string
        }
        Update: {
          company_name?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      reseller_delivery_groups: {
        Row: {
          delivery_group_id: string
          reseller_id: string
        }
        Insert: {
          delivery_group_id: string
          reseller_id: string
        }
        Update: {
          delivery_group_id?: string
          reseller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reseller_delivery_groups_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reseller_delivery_groups_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
        ]
      }
      reseller_order_fulfillments: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivery_id: string
          id: string
          invoice_number: string | null
          invoiced_at: string | null
          invoiced_by: string | null
          ready_confirmed_at: string | null
          ready_confirmed_by: string | null
          status: Database["public"]["Enums"]["reseller_order_status"]
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivery_id: string
          id?: string
          invoice_number?: string | null
          invoiced_at?: string | null
          invoiced_by?: string | null
          ready_confirmed_at?: string | null
          ready_confirmed_by?: string | null
          status?: Database["public"]["Enums"]["reseller_order_status"]
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivery_id?: string
          id?: string
          invoice_number?: string | null
          invoiced_at?: string | null
          invoiced_by?: string | null
          ready_confirmed_at?: string | null
          ready_confirmed_by?: string | null
          status?: Database["public"]["Enums"]["reseller_order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reseller_order_fulfillments_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reseller_order_fulfillments_invoiced_by_fkey"
            columns: ["invoiced_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reseller_order_fulfillments_ready_confirmed_by_fkey"
            columns: ["ready_confirmed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      reseller_par_levels: {
        Row: {
          created_at: string
          id: string
          par_level_quantity: number
          product_id: string
          reseller_id: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          par_level_quantity: number
          product_id: string
          reseller_id: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          par_level_quantity?: number
          product_id?: string
          reseller_id?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reseller_par_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reseller_par_levels_reseller_id_fkey"
            columns: ["reseller_id"]
            isOneToOne: false
            referencedRelation: "resellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reseller_par_levels_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      resellers: {
        Row: {
          active: boolean
          auth_user_id: string | null
          business_name: string
          company_id: string | null
          contact_email: string | null
          contact_phone: string
          created_at: string
          id: string
          is_important_client: boolean
          location_name: string
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          business_name: string
          company_id?: string | null
          contact_email?: string | null
          contact_phone: string
          created_at?: string
          id?: string
          is_important_client?: boolean
          location_name: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          business_name?: string
          company_id?: string | null
          contact_email?: string | null
          contact_phone?: string
          created_at?: string
          id?: string
          is_important_client?: boolean
          location_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "resellers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "reseller_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_stock: {
        Row: {
          product_id: string
          quantity_bocp_global: number
          quantity_reserved: number
          updated_at: string
        }
        Insert: {
          product_id: string
          quantity_bocp_global?: number
          quantity_reserved?: number
          updated_at?: string
        }
        Update: {
          product_id?: string
          quantity_bocp_global?: number
          quantity_reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_online_order: { Args: { p_order_id: string }; Returns: boolean }
      hand_online_order_to_courier: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      mark_online_order_ready: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      release_online_order: { Args: { p_order_id: string }; Returns: boolean }
      scan_online_order_item: {
        Args: { p_ean: string; p_order_id: string }
        Returns: boolean
      }
    }
    Enums: {
      cart_status: "open" | "pending_delivery" | "delivered"
      delivery_status:
        | "pending_confirmation"
        | "confirmed"
        | "in_transit"
        | "completed"
      delivery_trigger_type: "manual" | "important_client" | "countdown_48h"
      notification_channel: "in_app" | "email" | "browser" | "whatsapp"
      online_order_status:
        | "pending"
        | "claimed"
        | "preparing"
        | "ready"
        | "handed_to_courier"
        | "returned"
      order_source: "shopify" | "marketplace"
      refill_request_status:
        | "pending_confirmation"
        | "confirmed"
        | "rejected"
        | "flagged_for_review"
      reseller_order_status:
        | "preparing"
        | "ready_to_deliver"
        | "invoiced"
        | "delivered"
      return_reason:
        | "neridicat"
        | "refuzat_livrare"
        | "produs_deteriorat"
        | "altul"
      return_status: "pending_restock" | "restocked"
      user_role: "admin" | "owner" | "operator_depozit" | "operator_facturare"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cart_status: ["open", "pending_delivery", "delivered"],
      delivery_status: [
        "pending_confirmation",
        "confirmed",
        "in_transit",
        "completed",
      ],
      delivery_trigger_type: ["manual", "important_client", "countdown_48h"],
      notification_channel: ["in_app", "email", "browser", "whatsapp"],
      online_order_status: [
        "pending",
        "claimed",
        "preparing",
        "ready",
        "handed_to_courier",
        "returned",
      ],
      order_source: ["shopify", "marketplace"],
      refill_request_status: [
        "pending_confirmation",
        "confirmed",
        "rejected",
        "flagged_for_review",
      ],
      reseller_order_status: [
        "preparing",
        "ready_to_deliver",
        "invoiced",
        "delivered",
      ],
      return_reason: [
        "neridicat",
        "refuzat_livrare",
        "produs_deteriorat",
        "altul",
      ],
      return_status: ["pending_restock", "restocked"],
      user_role: ["admin", "owner", "operator_depozit", "operator_facturare"],
    },
  },
} as const
