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
      app_settings: {
        Row: {
          id: number
          launched_on: string | null
          launched_at: string | null
          launched_by: string | null
          auto_import: boolean
          auto_import_changed_at: string | null
          auto_import_changed_by: string | null
          last_auto_import_at: string | null
          last_auto_import: Json | null
          push_dispatch_url: string | null
        }
        Insert: { id?: number }
        Update: { id?: number }
        Relationships: []
      }
      push_subscriptions: {
        Row: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; user_agent: string | null; created_at: string; last_used_at: string | null }
        Insert: { id?: string }
        Update: { last_used_at?: string | null }
        Relationships: []
      }
      app_users: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          notification_email: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          username: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          id: string
          notification_email?: string | null
          username?: string | null
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          notification_email?: string | null
          username?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
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
          recipient_partner_id: string | null
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
          recipient_partner_id?: string | null
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
          recipient_partner_id?: string | null
          recipient_role?: Database["public"]["Enums"]["user_role"] | null
          recipient_user_id?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_partner_id_fkey"
            columns: ["recipient_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
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
          ean: string | null
          id: string
          is_gift: boolean
          order_id: string
          product_id: string
          quantity: number
          scan_code: string
          scan_code_type: "sku" | "ean"
          scanned_quantity: number
        }
        Insert: {
          created_at?: string
          ean?: string | null
          id?: string
          is_gift?: boolean
          order_id: string
          product_id: string
          quantity: number
          scan_code: string
          scan_code_type?: "sku" | "ean"
          scanned_quantity?: number
        }
        Update: {
          created_at?: string
          ean?: string | null
          id?: string
          is_gift?: boolean
          order_id?: string
          product_id?: string
          quantity?: number
          scan_code?: string
          scan_code_type?: "sku" | "ean"
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
          bocp_invoice_id: string | null
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
          ready_at: string | null
          released_at: string | null
          shipping_address: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["online_order_status"]
        }
        Insert: {
          bocp_invoice_id?: string | null
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
          ready_at?: string | null
          released_at?: string | null
          shipping_address?: string | null
          source: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["online_order_status"]
        }
        Update: {
          bocp_invoice_id?: string | null
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
          ready_at?: string | null
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
          restocked_at: string | null
          restocked_by: string | null
          restock_note: string | null
          restocked_with_remarks: boolean
          shopify_marked_manually: boolean
          status: Database["public"]["Enums"]["return_status"]
        }
        Insert: {
          id?: string
          online_order_id: string
          reason?: Database["public"]["Enums"]["return_reason"]
          registered_at?: string
          registered_by?: string | null
          restocked_at?: string | null
          restocked_by?: string | null
          restock_note?: string | null
          restocked_with_remarks?: boolean
          shopify_marked_manually?: boolean
          status?: Database["public"]["Enums"]["return_status"]
        }
        Update: {
          id?: string
          online_order_id?: string
          reason?: Database["public"]["Enums"]["return_reason"]
          registered_at?: string
          registered_by?: string | null
          restocked_at?: string | null
          restocked_by?: string | null
          restock_note?: string | null
          restocked_with_remarks?: boolean
          shopify_marked_manually?: boolean
          status?: Database["public"]["Enums"]["return_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_returns_online_order_id_fkey"
            columns: ["online_order_id"]
            isOneToOne: true
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
          {
            foreignKeyName: "order_returns_restocked_by_fkey"
            columns: ["restocked_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_collection_items: {
        Row: { collection_id: string; position: number; product_id: string }
        Insert: { collection_id: string; position?: number; product_id: string }
        Update: { collection_id?: string; position?: number; product_id?: string }
        Relationships: [
          { foreignKeyName: "product_collection_items_collection_id_fkey"; columns: ["collection_id"]; isOneToOne: false; referencedRelation: "product_collections"; referencedColumns: ["id"] },
          { foreignKeyName: "product_collection_items_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] },
        ]
      }
      product_collections: {
        Row: { created_at: string; created_by: string; id: string; name: string; updated_at: string }
        Insert: { created_at?: string; created_by: string; id?: string; name: string; updated_at?: string }
        Update: { created_at?: string; created_by?: string; id?: string; name?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: "product_collections_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "app_users"; referencedColumns: ["id"] },
        ]
      }
      products: {
        Row: {
          delisted: boolean
          list_price: number | null
          list_price_with_vat: number | null
          vat_percent: number | null
          active: boolean
          bocp_product_id: string | null
          category: string | null
          created_at: string
          ean: string | null
          id: string
          image_url: string | null
          name: string
          scan_mode: string
          sku: string
          synced_at: string | null
          variant_label: string | null
        }
        Insert: {
          delisted?: boolean
          list_price?: number | null
          list_price_with_vat?: number | null
          vat_percent?: number | null
          active?: boolean
          bocp_product_id?: string | null
          category?: string | null
          created_at?: string
          ean?: string | null
          id?: string
          image_url?: string | null
          name: string
          scan_mode?: string
          sku: string
          synced_at?: string | null
          variant_label?: string | null
        }
        Update: {
          delisted?: boolean
          list_price?: number | null
          list_price_with_vat?: number | null
          vat_percent?: number | null
          active?: boolean
          bocp_product_id?: string | null
          category?: string | null
          created_at?: string
          ean?: string | null
          id?: string
          image_url?: string | null
          name?: string
          scan_mode?: string
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
          partner_id: string | null
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
          partner_id?: string | null
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
          partner_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["refill_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "refill_request_cart_item_fk"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "partner_cart_items"
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
            foreignKeyName: "refill_requests_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_cart_items: {
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
            foreignKeyName: "partner_cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "partner_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_cart_items_refill_request_id_fkey"
            columns: ["refill_request_id"]
            isOneToOne: true
            referencedRelation: "refill_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_carts: {
        Row: {
          invoice_due_date: string | null
          invoice_last_payment_date: string | null
          invoice_rest: number | null
          invoice_total: number | null
          payment_checked_at: string | null
          source_document_id: string | null
          bocp_order_id: string | null
          bocp_order_error: string | null
          bocp_order_attempted_at: string | null
          countdown_started_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_by: string | null
          bocp_invoice_id: string | null
          id: string
          invoice_date: string | null
          invoice_pdf_url: string | null
          invoice_number: string | null
          invoiced_at: string | null
          invoiced_by: string | null
          partner_id: string
          prepared_at: string | null
          prepared_by: string | null
          reserved_in_bocp_at: string | null
          reserved_in_bocp_by: string | null
          status: Database["public"]["Enums"]["cart_status"]
        }
        Insert: {
          invoice_due_date?: string | null
          invoice_last_payment_date?: string | null
          invoice_rest?: number | null
          invoice_total?: number | null
          payment_checked_at?: string | null
          source_document_id?: string | null
          bocp_order_id?: string | null
          bocp_order_error?: string | null
          bocp_order_attempted_at?: string | null
          countdown_started_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          bocp_invoice_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_pdf_url?: string | null
          invoice_number?: string | null
          invoiced_at?: string | null
          invoiced_by?: string | null
          partner_id: string
          prepared_at?: string | null
          prepared_by?: string | null
          reserved_in_bocp_at?: string | null
          reserved_in_bocp_by?: string | null
          status?: Database["public"]["Enums"]["cart_status"]
        }
        Update: {
          invoice_due_date?: string | null
          invoice_last_payment_date?: string | null
          invoice_rest?: number | null
          invoice_total?: number | null
          payment_checked_at?: string | null
          source_document_id?: string | null
          bocp_order_id?: string | null
          bocp_order_error?: string | null
          bocp_order_attempted_at?: string | null
          countdown_started_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          bocp_invoice_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_pdf_url?: string | null
          invoice_number?: string | null
          invoiced_at?: string | null
          invoiced_by?: string | null
          partner_id?: string
          prepared_at?: string | null
          prepared_by?: string | null
          reserved_in_bocp_at?: string | null
          reserved_in_bocp_by?: string | null
          status?: Database["public"]["Enums"]["cart_status"]
        }
        Relationships: [
          {
            foreignKeyName: "partner_carts_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "sales_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_carts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_companies: {
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
      partner_delivery_groups: {
        Row: {
          delivery_group_id: string
          partner_id: string
        }
        Insert: {
          delivery_group_id: string
          partner_id: string
        }
        Update: {
          delivery_group_id?: string
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_delivery_groups_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_delivery_groups_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_par_levels: {
        Row: {
          created_at: string
          id: string
          par_level_quantity: number
          product_id: string
          partner_id: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          par_level_quantity: number
          product_id: string
          partner_id: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          par_level_quantity?: number
          product_id?: string
          partner_id?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_par_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_par_levels_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_par_levels_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          account_id: string | null
          bocp_contact_id: string | null
          billing_name: string | null
          vat_id: string | null
          registration_number: string | null
          billing_street: string | null
          billing_city: string | null
          billing_county: string | null
          billing_zip: string | null
          billing_country: string
          active: boolean
          account_username: string | null
          auth_user_id: string | null
          business_name: string
          company_id: string | null
          contact_email: string | null
          contact_phone: string
          created_at: string
          id: string
          is_important_client: boolean
          location_name: string
          type: string
        }
        Insert: {
          account_id?: string | null
          bocp_contact_id?: string | null
          billing_name?: string | null
          vat_id?: string | null
          registration_number?: string | null
          billing_street?: string | null
          billing_city?: string | null
          billing_county?: string | null
          billing_zip?: string | null
          billing_country?: string
          active?: boolean
          account_username?: string | null
          auth_user_id?: string | null
          business_name: string
          company_id?: string | null
          contact_email?: string | null
          contact_phone: string
          created_at?: string
          id?: string
          is_important_client?: boolean
          location_name: string
          type?: string
        }
        Update: {
          account_id?: string | null
          bocp_contact_id?: string | null
          billing_name?: string | null
          vat_id?: string | null
          registration_number?: string | null
          billing_street?: string | null
          billing_city?: string | null
          billing_county?: string | null
          billing_zip?: string | null
          billing_country?: string
          active?: boolean
          account_username?: string | null
          auth_user_id?: string | null
          business_name?: string
          company_id?: string | null
          contact_email?: string | null
          contact_phone?: string
          created_at?: string
          id?: string
          is_important_client?: boolean
          location_name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "partners_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "partner_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_discounts: {
        Row: { category: string | null; created_at: string; id: string; partner_id: string; percent: number }
        Insert: { category?: string | null; created_at?: string; id?: string; partner_id: string; percent: number }
        Update: { category?: string | null; created_at?: string; id?: string; partner_id?: string; percent?: number }
        Relationships: [
          { foreignKeyName: "partner_discounts_partner_id_fkey"; columns: ["partner_id"]; isOneToOne: false; referencedRelation: "partners"; referencedColumns: ["id"] },
        ]
      }
      sales_document_items: {
        Row: {
          discount_percent: number | null; document_id: string; id: string; name: string; position: number; product_id: string; quantity: number; sku: string; unit_price: number; vat_percent: number }
        Insert: {
          discount_percent?: number | null; document_id: string; id?: string; name: string; position?: number; product_id: string; quantity: number; sku: string; unit_price: number; vat_percent: number }
        Update: {
          discount_percent?: number | null; document_id?: string; id?: string; name?: string; position?: number; product_id?: string; quantity?: number; sku?: string; unit_price?: number; vat_percent?: number }
        Relationships: [
          { foreignKeyName: "sales_document_items_document_id_fkey"; columns: ["document_id"]; isOneToOne: false; referencedRelation: "sales_documents"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_document_items_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] },
        ]
      }
      sales_documents: {
        Row: {
          invoice_due_date: string | null; invoice_last_payment_date: string | null; invoice_rest: number | null; invoice_total: number | null; payment_checked_at: string | null
          account_id: string; cart_id: string | null; client_city: string | null; client_county: string | null; client_name: string
          client_registration: string | null; client_street: string | null; client_vat_id: string | null; client_zip: string | null
          contact_email: string | null; contact_name: string | null; contact_phone: string | null; created_at: string; discount_percent: number
          id: string; issued_at: string | null; kind: string; notes: string | null; number: string | null; partner_id: string | null
          save_as_partner: boolean; sent_at: string | null; status: string; updated_at: string; validity_days: number
          source_document_id: string | null; bocp_order_id: string | null; bocp_error: string | null; bocp_proforma_id: string | null; bocp_proforma_date: string | null; bocp_proforma_total: number | null; invoice_requested_at: string | null; invoice_requested_by: string | null; invoiced_at: string | null
          invoiced_by: string | null; invoice_number: string | null; bocp_invoice_id: string | null; invoice_date: string | null; invoice_pdf_url: string | null; cancel_requested_at: string | null; cancel_reason: string | null; cancelled_at: string | null; cancelled_by: string | null
        }
        Insert: {
          invoice_due_date?: string | null; invoice_last_payment_date?: string | null; invoice_rest?: number | null; invoice_total?: number | null; payment_checked_at?: string | null
          account_id: string; cart_id?: string | null; client_city?: string | null; client_county?: string | null; client_name: string
          client_registration?: string | null; client_street?: string | null; client_vat_id?: string | null; client_zip?: string | null
          contact_email?: string | null; contact_name?: string | null; contact_phone?: string | null; created_at?: string; discount_percent?: number
          id?: string; issued_at?: string | null; kind: string; notes?: string | null; number?: string | null; partner_id?: string | null
          save_as_partner?: boolean; sent_at?: string | null; status?: string; updated_at?: string; validity_days?: number
          source_document_id?: string | null; bocp_order_id?: string | null; bocp_error?: string | null; bocp_proforma_id?: string | null; bocp_proforma_date?: string | null; bocp_proforma_total?: number | null; invoice_requested_at?: string | null; invoice_requested_by?: string | null; invoiced_at?: string | null
          invoiced_by?: string | null; invoice_number?: string | null; bocp_invoice_id?: string | null; invoice_date?: string | null; invoice_pdf_url?: string | null; cancel_requested_at?: string | null; cancel_reason?: string | null; cancelled_at?: string | null; cancelled_by?: string | null
        }
        Update: {
          invoice_due_date?: string | null; invoice_last_payment_date?: string | null; invoice_rest?: number | null; invoice_total?: number | null; payment_checked_at?: string | null
          account_id?: string; cart_id?: string | null; client_city?: string | null; client_county?: string | null; client_name?: string
          client_registration?: string | null; client_street?: string | null; client_vat_id?: string | null; client_zip?: string | null
          contact_email?: string | null; contact_name?: string | null; contact_phone?: string | null; created_at?: string; discount_percent?: number
          id?: string; issued_at?: string | null; kind?: string; notes?: string | null; number?: string | null; partner_id?: string | null
          save_as_partner?: boolean; sent_at?: string | null; status?: string; updated_at?: string; validity_days?: number
          source_document_id?: string | null; bocp_order_id?: string | null; bocp_error?: string | null; bocp_proforma_id?: string | null; bocp_proforma_date?: string | null; bocp_proforma_total?: number | null; invoice_requested_at?: string | null; invoice_requested_by?: string | null; invoiced_at?: string | null
          invoiced_by?: string | null; invoice_number?: string | null; bocp_invoice_id?: string | null; invoice_date?: string | null; invoice_pdf_url?: string | null; cancel_requested_at?: string | null; cancel_reason?: string | null; cancelled_at?: string | null; cancelled_by?: string | null
        }
        Relationships: [
          { foreignKeyName: "sales_documents_account_id_fkey"; columns: ["account_id"]; isOneToOne: false; referencedRelation: "app_users"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_documents_cart_id_fkey"; columns: ["cart_id"]; isOneToOne: false; referencedRelation: "partner_carts"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_documents_partner_id_fkey"; columns: ["partner_id"]; isOneToOne: false; referencedRelation: "partners"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_documents_source_document_id_fkey"; columns: ["source_document_id"]; isOneToOne: false; referencedRelation: "sales_documents"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_documents_invoice_requested_by_fkey"; columns: ["invoice_requested_by"]; isOneToOne: false; referencedRelation: "app_users"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_documents_invoiced_by_fkey"; columns: ["invoiced_by"]; isOneToOne: false; referencedRelation: "app_users"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_documents_cancelled_by_fkey"; columns: ["cancelled_by"]; isOneToOne: false; referencedRelation: "app_users"; referencedColumns: ["id"] },
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
      owner_clients: {
        Args: { p_from: string | null; p_to: string | null }
        Returns: { id: string; name: string; location: string; type: string; active: boolean; agent: string | null; delivery_groups: string[]; orders: number; units: number; invoiced_value: number; outstanding: number; last_order: string | null }[]
      }
      team_activity: { Args: { p_from: string; p_inactive_days: number; p_to: string }; Returns: Json }
      account_invoices: {
        Args: never
        Returns: { source: string; id: string; partner_name: string; invoice_number: string; invoice_date: string; due_date: string | null; total: number | null; rest: number | null; invoiced_at: string; proforma_number: string | null }[]
      }
      submit_refill_counts_for: { Args: { p_counts: Json; p_partner_id: string }; Returns: Json }
      b2b_receivables: {
        Args: never
        Returns: { source: string; id: string; partner_name: string; agent_name: string | null; invoice_number: string; invoice_date: string; due_date: string | null; total: number | null; rest: number | null; payment_checked_at: string | null }[]
      }
      invoices_to_check: { Args: { p_limit: number }; Returns: { source: string; id: string; bocp_invoice_id: string }[] }
      record_invoice_payment: {
        Args: { p_source: string; p_id: string; p_due_date: string | null; p_total: number | null; p_rest: number | null; p_last_payment: string | null }
        Returns: boolean
      }
      partner_invoices: {
        Args: { p_partner_id: string }
        Returns: { bocp_invoice_id: string; id: string; invoice_date: string; invoice_number: string; invoice_pdf_url: string | null; invoiced_at: string; source: string; due_date: string | null; rest: number | null }[]
      }
      delete_product_collection: { Args: { p_id: string }; Returns: boolean }
      save_product_collection: { Args: { p_id: string | null; p_name: string; p_product_ids: string[] }; Returns: string | null }
      confirm_proforma_cancelled: { Args: { p_id: string }; Returns: boolean }
      mark_document_invoiced: {
        Args: { p_bocp_invoice_id: string; p_id: string; p_invoice_date: string; p_invoice_number: string; p_invoice_pdf_url: string | null }
        Returns: boolean
      }
      offer_to_proforma: { Args: { p_id: string }; Returns: string | null }
      record_proforma_number: {
        Args: { p_bocp_proforma_id: string; p_date: string; p_id: string; p_number: string; p_total: number | null }
        Returns: boolean
      }
      record_proforma_order: { Args: { p_bocp_order_id: string | null; p_error: string | null; p_id: string }; Returns: boolean }
      request_document_invoice: { Args: { p_id: string }; Returns: boolean }
      request_proforma_cancel: { Args: { p_id: string; p_reason: string | null }; Returns: boolean }
      start_proforma_issue: { Args: { p_id: string }; Returns: boolean }
      claim_online_order: { Args: { p_order_id: string }; Returns: boolean }
      issue_sales_document: { Args: { p_id: string }; Returns: string | null }
      partner_directory: {
        Args: never
        Returns: { account_id: string | null; account_name: string | null; active: boolean; business_name: string; id: string; location_name: string
          delivery_groups: string[]; type: string }[]
      }
      save_partner_discounts: { Args: { p_partner_id: string; p_rules: Json }; Returns: boolean }
      save_partner_profile: { Args: { p_data: Json; p_partner_id: string | null }; Returns: string | null }
      save_sales_document: { Args: { p_doc: Json; p_id: string | null; p_items: Json }; Returns: string | null }
      send_sales_document: { Args: { p_id: string }; Returns: string | null }
      set_partner_par_level: { Args: { p_partner_id: string; p_product_id: string; p_quantity: number }; Returns: boolean }
      link_partner_account: {
        Args: { p_email: string; p_partner_id: string }
        Returns: string
      }
      mark_notifications_read: { Args: { p_ids: string[] | null }; Returns: number }
      remove_cart_item: { Args: { p_item_id: string }; Returns: boolean }
      staff_add_refill: {
        Args: { p_items: Json; p_partner_id: string; p_source: string }
        Returns: Json
      }
      submit_refill_counts: { Args: { p_counts: Json }; Returns: Json }
      enable_ean_for_all: { Args: never; Returns: number }
      sync_bocp_catalog: { Args: { p_products: Json }; Returns: Json }
      set_product_ean: {
        Args: { p_ean: string; p_product_id: string }
        Returns: string
      }
      set_product_scan_mode: {
        Args: { p_mode: string; p_product_id: string }
        Returns: string
      }
      confirm_online_order_item: {
        Args: { p_item_id: string; p_order_id: string }
        Returns: boolean
      }
      confirm_return_restock: {
        Args: { p_note?: string; p_return_id: string; p_with_remarks?: boolean }
        Returns: boolean
      }
      delete_delivery_group: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      dashboard_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      hand_partner_cart_to_billing: {
        Args: { p_cart_id: string }
        Returns: boolean
      }
      hand_online_order_to_courier: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      mark_partner_cart_invoiced: {
        Args: { p_bocp_invoice_id: string; p_cart_id: string; p_invoice_date: string; p_invoice_number: string; p_invoice_pdf_url: string | null }
        Returns: boolean
      }
      mark_partner_cart_prepared: {
        Args: { p_cart_id: string }
        Returns: boolean
      }
      mark_online_order_ready: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      mark_return_in_shopify: {
        Args: { p_return_id: string }
        Returns: boolean
      }
      record_partner_cart_bocp_order: {
        Args: { p_bocp_order_id: string | null; p_cart_id: string; p_error: string | null }
        Returns: boolean
      }
      register_order_return: {
        Args: {
          p_order_id: string
          p_reason: Database["public"]["Enums"]["return_reason"]
          p_shopify_marked: boolean
        }
        Returns: boolean
      }
      release_online_order: { Args: { p_order_id: string }; Returns: boolean }
      delete_staff_user: { Args: { p_id: string }; Returns: string }
      save_push_subscription: { Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent: string }; Returns: boolean }
      delete_push_subscription: { Args: { p_endpoint: string }; Returns: boolean }
      claim_push_notifications: {
        Args: { p_limit: number }
        Returns: { id: string; message: string; related_entity_type: string | null; recipient_user_id: string | null; recipient_role: Database["public"]["Enums"]["user_role"] | null }[]
      }
      import_bocp_online_orders_job: { Args: { p_orders: Json }; Returns: Json }
      record_manual_import: { Args: { p_from: string }; Returns: undefined }
      set_auto_import: { Args: { p_on: boolean }; Returns: boolean }
      record_auto_import: { Args: { p_result: Json }; Returns: undefined }
      import_bocp_online_orders: {
        Args: { p_orders: Json }
        Returns: Json
      }
      save_delivery_group: {
        Args: { p_group_id: string | null; p_name: string; p_partner_ids: string[] }
        Returns: string | null
      }
      scan_online_order_code: {
        Args: { p_code: string; p_order_id: string }
        Returns: boolean
      }
      search_online_orders: { Args: { p_query: string }; Returns: Json }
      staff_names: {
        Args: never
        Returns: { full_name: string; id: string }[]
      }
    }
    Enums: {
      cart_status: "open" | "prepared" | "pending_delivery" | "delivered"
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
      return_reason:
        | "neridicat"
        | "refuzat_livrare"
        | "produs_deteriorat"
        | "altul"
      return_status: "pending_restock" | "restocked"
      user_role: "admin" | "owner" | "operator_depozit" | "operator_facturare" | "account"
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
      cart_status: ["open", "prepared", "pending_delivery", "delivered"],
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
      return_reason: [
        "neridicat",
        "refuzat_livrare",
        "produs_deteriorat",
        "altul",
      ],
      return_status: ["pending_restock", "restocked"],
      user_role: ["admin", "owner", "operator_depozit", "operator_facturare", "account"],
    },
  },
} as const
