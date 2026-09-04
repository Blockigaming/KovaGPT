export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_generation_events: {
        Row: {
          actual_cost_usd: number | null;
          cached_input_tokens: number | null;
          context_trimmed: boolean;
          conversation_id: string | null;
          created_at: string;
          error: string | null;
          estimated_cost_usd: number;
          estimated_input_tokens: number;
          finalized_at: string | null;
          guest_ip_hash: string | null;
          id: string;
          idempotency_key: string;
          input_tokens: number | null;
          latency_ms: number | null;
          lease_expires_at: string;
          mode: string;
          model: string;
          output_tokens: number | null;
          period_end: string;
          period_start: string;
          plan: string;
          premium: boolean;
          reasoning_tokens: number | null;
          request_id: string;
          reserved_tokens: number;
          status: string;
          tools: Json | null;
          user_id: string | null;
        };
        Insert: {
          actual_cost_usd?: number | null;
          cached_input_tokens?: number | null;
          context_trimmed?: boolean;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          estimated_cost_usd?: number;
          estimated_input_tokens?: number;
          finalized_at?: string | null;
          guest_ip_hash?: string | null;
          id?: string;
          idempotency_key: string;
          input_tokens?: number | null;
          latency_ms?: number | null;
          lease_expires_at: string;
          mode: string;
          model: string;
          output_tokens?: number | null;
          period_end: string;
          period_start: string;
          plan: string;
          premium?: boolean;
          reasoning_tokens?: number | null;
          request_id: string;
          reserved_tokens?: number;
          status?: string;
          tools?: Json | null;
          user_id?: string | null;
        };
        Update: {
          actual_cost_usd?: number | null;
          cached_input_tokens?: number | null;
          context_trimmed?: boolean;
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          estimated_cost_usd?: number;
          estimated_input_tokens?: number;
          finalized_at?: string | null;
          guest_ip_hash?: string | null;
          id?: string;
          idempotency_key?: string;
          input_tokens?: number | null;
          latency_ms?: number | null;
          lease_expires_at?: string;
          mode?: string;
          model?: string;
          output_tokens?: number | null;
          period_end?: string;
          period_start?: string;
          plan?: string;
          premium?: boolean;
          reasoning_tokens?: number | null;
          request_id?: string;
          reserved_tokens?: number;
          status?: string;
          tools?: Json | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      banned_users: {
        Row: {
          banned_at: string;
          reason: string | null;
          user_id: string;
        };
        Insert: {
          banned_at?: string;
          reason?: string | null;
          user_id: string;
        };
        Update: {
          banned_at?: string;
          reason?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      chat_branches: {
        Row: {
          active: boolean;
          branch_from_message_id: string | null;
          branch_from_message_index: number | null;
          branch_from_parent_message_id: string | null;
          chat_id: string;
          created_at: string;
          id: string;
          label: string | null;
          message_ids: string[];
          owner_id: string;
          parent_branch_id: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          branch_from_message_id?: string | null;
          branch_from_message_index?: number | null;
          branch_from_parent_message_id?: string | null;
          chat_id: string;
          created_at?: string;
          id?: string;
          label?: string | null;
          message_ids?: string[];
          owner_id: string;
          parent_branch_id?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          branch_from_message_id?: string | null;
          branch_from_message_index?: number | null;
          branch_from_parent_message_id?: string | null;
          chat_id?: string;
          created_at?: string;
          id?: string;
          label?: string | null;
          message_ids?: string[];
          owner_id?: string;
          parent_branch_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_branches_parent_branch_id_fkey";
            columns: ["parent_branch_id"];
            isOneToOne: false;
            referencedRelation: "chat_branches";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_custom_rules: {
        Row: {
          chat_id: string;
          created_at: string;
          enabled: boolean;
          id: string;
          instructions: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          chat_id: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          instructions?: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          chat_id?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          instructions?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_memories: {
        Row: {
          chat_id: string;
          created_at: string;
          id: string;
          message_count: number;
          summary: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          chat_id: string;
          created_at?: string;
          id?: string;
          message_count?: number;
          summary: string;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          chat_id?: string;
          created_at?: string;
          id?: string;
          message_count?: number;
          summary?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      chat_message_versions: {
        Row: {
          accepted: boolean;
          branch_id: string | null;
          chat_id: string;
          content: string;
          created_at: string;
          edit_instruction: string | null;
          id: string;
          message_id: string;
          original_content: string | null;
          owner_id: string;
          source: string;
          version: number;
        };
        Insert: {
          accepted?: boolean;
          branch_id?: string | null;
          chat_id: string;
          content: string;
          created_at?: string;
          edit_instruction?: string | null;
          id?: string;
          message_id: string;
          original_content?: string | null;
          owner_id: string;
          source: string;
          version: number;
        };
        Update: {
          accepted?: boolean;
          branch_id?: string | null;
          chat_id?: string;
          content?: string;
          created_at?: string;
          edit_instruction?: string | null;
          id?: string;
          message_id?: string;
          original_content?: string | null;
          owner_id?: string;
          source?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "chat_message_versions_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "chat_branches";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_pinned_files: {
        Row: {
          chat_id: string;
          created_at: string;
          id: string;
          owner_id: string;
          project_id: string | null;
          source_id: string;
          source_type: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          chat_id: string;
          created_at?: string;
          id?: string;
          owner_id: string;
          project_id?: string | null;
          source_id: string;
          source_type: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          chat_id?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          project_id?: string | null;
          source_id?: string;
          source_type?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_pinned_files_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      connected_account_audit_log: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          provider: string;
          resource_id: string | null;
          status: string;
          summary: string | null;
          user_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          provider: string;
          resource_id?: string | null;
          status?: string;
          summary?: string | null;
          user_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          provider?: string;
          resource_id?: string | null;
          status?: string;
          summary?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      daily_usage: {
        Row: {
          chats: number;
          images: number;
          updated_at: string;
          uploads: number;
          usage_date: string;
          user_id: string;
          voice: number;
        };
        Insert: {
          chats?: number;
          images?: number;
          updated_at?: string;
          uploads?: number;
          usage_date?: string;
          user_id: string;
          voice?: number;
        };
        Update: {
          chats?: number;
          images?: number;
          updated_at?: string;
          uploads?: number;
          usage_date?: string;
          user_id?: string;
          voice?: number;
        };
        Relationships: [];
      };
      email_send_log: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          message_id: string | null;
          metadata: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email?: string;
          status?: string;
          template_name?: string;
        };
        Relationships: [];
      };
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number;
          batch_size: number;
          id: number;
          retry_after_until: string | null;
          send_delay_ms: number;
          transactional_email_ttl_minutes: number;
          updated_at: string;
        };
        Insert: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Update: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_unsubscribe_tokens: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          token: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          token: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      family_groups: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      family_invites: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          created_by: string;
          expires_at: string;
          group_id: string;
          id: string;
          invited_email: string | null;
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          created_by: string;
          expires_at?: string;
          group_id: string;
          id?: string;
          invited_email?: string | null;
          token: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          group_id?: string;
          id?: string;
          invited_email?: string | null;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "family_invites_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "family_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      family_members: {
        Row: {
          created_at: string;
          group_id: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          group_id: string;
          id?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          group_id?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "family_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "family_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      feature_flags: {
        Row: {
          enabled: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          enabled?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          enabled?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      financial_accounts: {
        Row: {
          account_name: string;
          account_subtype: string | null;
          account_type: string | null;
          available_balance: number | null;
          currency: string | null;
          current_balance: number | null;
          id: string;
          institution_name: string | null;
          mask: string | null;
          plaid_item_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_name: string;
          account_subtype?: string | null;
          account_type?: string | null;
          available_balance?: number | null;
          currency?: string | null;
          current_balance?: number | null;
          id?: string;
          institution_name?: string | null;
          mask?: string | null;
          plaid_item_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_name?: string;
          account_subtype?: string | null;
          account_type?: string | null;
          available_balance?: number | null;
          currency?: string | null;
          current_balance?: number | null;
          id?: string;
          institution_name?: string | null;
          mask?: string | null;
          plaid_item_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "financial_accounts_plaid_item_id_fkey";
            columns: ["plaid_item_id"];
            isOneToOne: false;
            referencedRelation: "plaid_items";
            referencedColumns: ["id"];
          },
        ];
      };
      google_oauth_tokens: {
        Row: {
          access_token: string;
          created_at: string;
          email: string | null;
          expires_at: string;
          google_sub: string | null;
          refresh_token: string | null;
          scopes: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token: string;
          created_at?: string;
          email?: string | null;
          expires_at: string;
          google_sub?: string | null;
          refresh_token?: string | null;
          scopes?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token?: string;
          created_at?: string;
          email?: string | null;
          expires_at?: string;
          google_sub?: string | null;
          refresh_token?: string | null;
          scopes?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      pending_tool_actions: {
        Row: {
          args: Json;
          created_at: string;
          expires_at: string;
          id: string;
          result: Json | null;
          status: string;
          summary: string | null;
          tool: string;
          user_id: string;
        };
        Insert: {
          args?: Json;
          created_at?: string;
          expires_at?: string;
          id?: string;
          result?: Json | null;
          status?: string;
          summary?: string | null;
          tool: string;
          user_id: string;
        };
        Update: {
          args?: Json;
          created_at?: string;
          expires_at?: string;
          id?: string;
          result?: Json | null;
          status?: string;
          summary?: string | null;
          tool?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      plaid_items: {
        Row: {
          access_token_encrypted: string | null;
          created_at: string;
          id: string;
          institution_name: string | null;
          plaid_item_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token_encrypted?: string | null;
          created_at?: string;
          id?: string;
          institution_name?: string | null;
          plaid_item_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token_encrypted?: string | null;
          created_at?: string;
          id?: string;
          institution_name?: string | null;
          plaid_item_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      processed_stripe_events: {
        Row: {
          environment: string;
          event_id: string;
          processed_at: string;
          type: string;
        };
        Insert: {
          environment: string;
          event_id: string;
          processed_at?: string;
          type: string;
        };
        Update: {
          environment?: string;
          event_id?: string;
          processed_at?: string;
          type?: string;
        };
        Relationships: [];
      };
      project_activity: {
        Row: {
          actor_id: string;
          created_at: string;
          id: string;
          kind: string;
          meta: Json;
          project_id: string;
          summary: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          id?: string;
          kind: string;
          meta?: Json;
          project_id: string;
          summary: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          meta?: Json;
          project_id?: string;
          summary?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_activity_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_chats: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          project_id: string;
          snapshot: Json;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          project_id: string;
          snapshot?: Json;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          project_id?: string;
          snapshot?: Json;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_chats_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_file_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          created_at: string;
          embedding: string;
          file_id: string;
          id: string;
          project_id: string;
        };
        Insert: {
          chunk_index: number;
          content: string;
          created_at?: string;
          embedding: string;
          file_id: string;
          id?: string;
          project_id: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          created_at?: string;
          embedding?: string;
          file_id?: string;
          id?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_file_chunks_file_id_fkey";
            columns: ["file_id"];
            isOneToOne: false;
            referencedRelation: "project_files";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_file_chunks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_files: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          mime_type: string | null;
          name: string;
          project_id: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind?: string;
          mime_type?: string | null;
          name: string;
          project_id: string;
          size_bytes?: number;
          storage_path: string;
          uploaded_by: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          mime_type?: string | null;
          name?: string;
          project_id?: string;
          size_bytes?: number;
          storage_path?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          id: string;
          invited_by: string;
          project_id: string;
          role: Database["public"]["Enums"]["project_role"];
          status: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          invited_by: string;
          project_id: string;
          role?: Database["public"]["Enums"]["project_role"];
          status?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          invited_by?: string;
          project_id?: string;
          role?: Database["public"]["Enums"]["project_role"];
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_invites_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          created_at: string;
          project_id: string;
          role: Database["public"]["Enums"]["project_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          project_id: string;
          role?: Database["public"]["Enums"]["project_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          project_id?: string;
          role?: Database["public"]["Enums"]["project_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_memory: {
        Row: {
          content: string;
          created_at: string;
          created_by: string;
          id: string;
          project_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          created_by: string;
          id?: string;
          project_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_memory_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_notes: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          project_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          content?: string;
          created_at?: string;
          id?: string;
          project_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          project_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "project_notes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: true;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_tasks: {
        Row: {
          completed_at: string | null;
          created_at: string;
          created_by: string;
          due_date: string | null;
          id: string;
          position: number;
          project_id: string;
          status: Database["public"]["Enums"]["project_task_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          created_by: string;
          due_date?: string | null;
          id?: string;
          position?: number;
          project_id: string;
          status?: Database["public"]["Enums"]["project_task_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          due_date?: string | null;
          id?: string;
          position?: number;
          project_id?: string;
          status?: Database["public"]["Enums"]["project_task_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          archived_at: string | null;
          color: string | null;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          owner_id: string;
          pinned_at: string | null;
          system_prompt: string | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          color?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          owner_id: string;
          pinned_at?: string | null;
          system_prompt?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          color?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          owner_id?: string;
          pinned_at?: string | null;
          system_prompt?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      scheduled_tasks: {
        Row: {
          created_at: string;
          id: string;
          last_result: string | null;
          last_run_at: string | null;
          next_run_at: string | null;
          prompt: string;
          repeat: string;
          run_at: string;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_result?: string | null;
          last_run_at?: string | null;
          next_run_at?: string | null;
          prompt: string;
          repeat?: string;
          run_at: string;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_result?: string | null;
          last_run_at?: string | null;
          next_run_at?: string | null;
          prompt?: string;
          repeat?: string;
          run_at?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shared_chats: {
        Row: {
          created_at: string;
          id: string;
          local_chat_reference: string | null;
          owner_user_id: string;
          permission: string;
          recipient_email: string;
          recipient_user_id: string | null;
          snapshot: Json;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          local_chat_reference?: string | null;
          owner_user_id: string;
          permission?: string;
          recipient_email: string;
          recipient_user_id?: string | null;
          snapshot: Json;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          local_chat_reference?: string | null;
          owner_user_id?: string;
          permission?: string;
          recipient_email?: string;
          recipient_user_id?: string | null;
          snapshot?: Json;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null;
          created_at: string | null;
          current_period_end: string | null;
          current_period_start: string | null;
          environment: string;
          id: string;
          last_stripe_event_created_at: string | null;
          last_stripe_event_id: string | null;
          price_id: string;
          product_id: string;
          status: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean | null;
          created_at?: string | null;
          current_period_end?: string | null;
          current_period_start?: string | null;
          environment?: string;
          id?: string;
          last_stripe_event_created_at?: string | null;
          last_stripe_event_id?: string | null;
          price_id: string;
          product_id: string;
          status?: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean | null;
          created_at?: string | null;
          current_period_end?: string | null;
          current_period_start?: string | null;
          environment?: string;
          id?: string;
          last_stripe_event_created_at?: string | null;
          last_stripe_event_id?: string | null;
          price_id?: string;
          product_id?: string;
          status?: string;
          stripe_customer_id?: string;
          stripe_subscription_id?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      suppressed_emails: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          metadata: Json | null;
          reason: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          metadata?: Json | null;
          reason: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          metadata?: Json | null;
          reason?: string;
        };
        Relationships: [];
      };
      library_folder_locks: {
        Row: {
          touched_at: string;
          user_id: string;
        };
        Insert: {
          touched_at?: string;
          user_id: string;
        };
        Update: {
          touched_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      library_folders: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          parent_id: string | null;
          position: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          parent_id?: string | null;
          position?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          parent_id?: string | null;
          position?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "library_folders_parent_owner_fk";
            columns: ["parent_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "library_folders";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      user_library_items: {
        Row: {
          content_text: string | null;
          created_at: string;
          file_name: string | null;
          file_size: number | null;
          file_type: string | null;
          file_url: string | null;
          folder_id: string | null;
          id: string;
          item_type: string;
          metadata: Json | null;
          source: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content_text?: string | null;
          created_at?: string;
          file_name?: string | null;
          file_size?: number | null;
          file_type?: string | null;
          file_url?: string | null;
          folder_id?: string | null;
          id?: string;
          item_type: string;
          metadata?: Json | null;
          source?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content_text?: string | null;
          created_at?: string;
          file_name?: string | null;
          file_size?: number | null;
          file_type?: string | null;
          file_url?: string | null;
          folder_id?: string | null;
          id?: string;
          item_type?: string;
          metadata?: Json | null;
          source?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_library_items_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "library_folders";
            referencedColumns: ["id"];
          },
        ];
      };
      user_onboarding: {
        Row: {
          completed: boolean;
          completed_at: string | null;
          created_at: string;
          primary_use: string | null;
          response_style: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          primary_use?: string | null;
          response_style?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          primary_use?: string | null;
          response_style?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_storage: {
        Row: {
          bytes_used: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          bytes_used?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bytes_used?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      writing_document_versions: {
        Row: {
          content: string;
          created_at: string;
          document_id: string;
          id: string;
          owner_id: string;
          source: string;
          title: string;
          version: number;
          word_count: number;
        };
        Insert: {
          content: string;
          created_at?: string;
          document_id: string;
          id?: string;
          owner_id: string;
          source?: string;
          title: string;
          version: number;
          word_count?: number;
        };
        Update: {
          content?: string;
          created_at?: string;
          document_id?: string;
          id?: string;
          owner_id?: string;
          source?: string;
          title?: string;
          version?: number;
          word_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "writing_document_versions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "writing_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      writing_documents: {
        Row: {
          archived_at: string | null;
          content: string;
          created_at: string;
          id: string;
          last_opened_at: string;
          owner_id: string;
          project_id: string | null;
          title: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          archived_at?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          last_opened_at?: string;
          owner_id: string;
          project_id?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          archived_at?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          last_opened_at?: string;
          owner_id?: string;
          project_id?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "writing_documents_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acquire_ai_generation: {
        Args: {
          p_context_trimmed: boolean;
          p_conversation_id: string;
          p_daily_limit: number;
          p_estimated_cost: number;
          p_estimated_input: number;
          p_global_concurrency: number;
          p_guest_ip_hash: string;
          p_guest_limit: number;
          p_idempotency_key: string;
          p_lease_seconds: number;
          p_mode: string;
          p_model: string;
          p_monthly_limit: number;
          p_period_end: string;
          p_period_start: string;
          p_plan: string;
          p_premium: boolean;
          p_premium_limit: number;
          p_principal_concurrency: number;
          p_request_id: string;
          p_reserved_tokens: number;
          p_user_id: string;
        };
        Returns: {
          decision: string;
          event_id: string;
        }[];
      };
      can_edit_project: {
        Args: { _project_id: string; _user_id: string };
        Returns: boolean;
      };
      delete_email: {
        Args: { message_id: number; queue_name: string };
        Returns: boolean;
      };
      email_queue_dispatch: { Args: never; Returns: undefined };
      enqueue_email: {
        Args: { payload: Json; queue_name: string };
        Returns: number;
      };
      family_owner_of: { Args: { _user_id: string }; Returns: string };
      finalize_ai_generation: {
        Args: {
          p_actual_cost: number;
          p_cached: number;
          p_error: string;
          p_event_id: string;
          p_input: number;
          p_latency: number;
          p_output: number;
          p_reasoning: number;
          p_status: string;
          p_tools: Json;
        };
        Returns: boolean;
      };
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string };
        Returns: boolean;
      };
      is_family_member: {
        Args: { _group_id: string; _user_id: string };
        Returns: boolean;
      };
      is_project_member: {
        Args: { _project_id: string; _user_id: string };
        Returns: boolean;
      };
      kova_accept_message_version: {
        Args: { p_version_id: string };
        Returns: {
          accepted: boolean;
          branch_id: string | null;
          chat_id: string;
          content: string;
          created_at: string;
          edit_instruction: string | null;
          id: string;
          message_id: string;
          original_content: string | null;
          owner_id: string;
          source: string;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "chat_message_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      kova_activate_chat_branch: {
        Args: { p_branch_id: string; p_chat_id: string };
        Returns: {
          active: boolean;
          branch_from_message_id: string | null;
          branch_from_message_index: number | null;
          branch_from_parent_message_id: string | null;
          chat_id: string;
          created_at: string;
          id: string;
          label: string | null;
          message_ids: string[];
          owner_id: string;
          parent_branch_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "chat_branches";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      kova_can_pin_source: {
        Args: {
          p_project_id: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: boolean;
      };
      kova_create_chat_branch: {
        Args: {
          p_activate?: boolean;
          p_branch_from_message_id?: string;
          p_branch_from_message_index?: number;
          p_branch_from_parent_message_id?: string;
          p_chat_id: string;
          p_label?: string;
          p_max_branches?: number;
          p_message_ids?: string[];
          p_parent_branch_id?: string;
        };
        Returns: {
          active: boolean;
          branch_from_message_id: string | null;
          branch_from_message_index: number | null;
          branch_from_parent_message_id: string | null;
          chat_id: string;
          created_at: string;
          id: string;
          label: string | null;
          message_ids: string[];
          owner_id: string;
          parent_branch_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "chat_branches";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      kova_record_message_version: {
        Args: {
          p_accepted?: boolean;
          p_branch_id?: string;
          p_chat_id: string;
          p_content: string;
          p_edit_instruction?: string;
          p_max_versions?: number;
          p_message_id: string;
          p_original_content?: string;
          p_source: string;
        };
        Returns: {
          accepted: boolean;
          branch_id: string | null;
          chat_id: string;
          content: string;
          created_at: string;
          edit_instruction: string | null;
          id: string;
          message_id: string;
          original_content: string | null;
          owner_id: string;
          source: string;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "chat_message_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      kova_update_chat_branch_messages: {
        Args: { p_branch_id: string; p_label?: string; p_message_ids: string[] };
        Returns: {
          active: boolean;
          branch_from_message_id: string | null;
          branch_from_message_index: number | null;
          branch_from_parent_message_id: string | null;
          chat_id: string;
          created_at: string;
          id: string;
          label: string | null;
          message_ids: string[];
          owner_id: string;
          parent_branch_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "chat_branches";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      match_project_chunks: {
        Args: {
          _project_id: string;
          match_count?: number;
          query_embedding: string;
        };
        Returns: {
          content: string;
          file_id: string;
          id: string;
          similarity: number;
        }[];
      };
      move_to_dlq: {
        Args: {
          dlq_name: string;
          message_id: number;
          payload: Json;
          source_queue: string;
        };
        Returns: number;
      };
      project_role_of: {
        Args: { _project_id: string; _user_id: string };
        Returns: Database["public"]["Enums"]["project_role"];
      };
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number };
        Returns: {
          message: Json;
          msg_id: number;
          read_ct: number;
        }[];
      };
      list_account_project_storage_objects: {
        Args: { p_owner_id: string; p_limit?: number };
        Returns: { name: string; owner_id: string }[];
      };
      save_writing_document: {
        Args: {
          p_content: string;
          p_expected_version: number;
          p_id: string;
          p_source: string;
          p_title: string;
        };
        Returns: {
          archived_at: string | null;
          content: string;
          created_at: string;
          id: string;
          last_opened_at: string;
          owner_id: string;
          project_id: string | null;
          title: string;
          updated_at: string;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "writing_documents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      try_add_storage_bytes: {
        Args: { _bytes: number; _limit: number; _user_id: string };
        Returns: boolean;
      };
      try_increment_daily_usage: {
        Args: {
          _increment: number;
          _kind: string;
          _limit: number;
          _user_id: string;
        };
        Returns: boolean;
      };
      user_plan_tier: { Args: { _user_id: string }; Returns: string };
    };
    Enums: {
      project_role: "owner" | "editor" | "viewer";
      project_task_status: "todo" | "doing" | "done";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      project_role: ["owner", "editor", "viewer"],
      project_task_status: ["todo", "doing", "done"],
    },
  },
} as const;
