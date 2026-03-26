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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          error: string | null
          id: string
          intent_text: string | null
          provider: Database["public"]["Enums"]["cloud_provider"] | null
          region: string | null
          resolved_calls: Json | null
          result: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          error?: string | null
          id?: string
          intent_text?: string | null
          provider?: Database["public"]["Enums"]["cloud_provider"] | null
          region?: string | null
          resolved_calls?: Json | null
          result?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          error?: string | null
          id?: string
          intent_text?: string | null
          provider?: Database["public"]["Enums"]["cloud_provider"] | null
          region?: string | null
          resolved_calls?: Json | null
          result?: string | null
          user_id?: string
        }
        Relationships: []
      }
      contributions: {
        Row: {
          contribution_type: string
          contributor_id: string
          created_at: string
          description: string | null
          id: string
          pr_url: string | null
          title: string
          xp_earned: number
        }
        Insert: {
          contribution_type: string
          contributor_id: string
          created_at?: string
          description?: string | null
          id?: string
          pr_url?: string | null
          title: string
          xp_earned?: number
        }
        Update: {
          contribution_type?: string
          contributor_id?: string
          created_at?: string
          description?: string | null
          id?: string
          pr_url?: string | null
          title?: string
          xp_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "contributions_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
        ]
      }
      contributor_badges: {
        Row: {
          awarded_at: string
          badge: Database["public"]["Enums"]["badge_type"]
          contributor_id: string
          id: string
        }
        Insert: {
          awarded_at?: string
          badge: Database["public"]["Enums"]["badge_type"]
          contributor_id: string
          id?: string
        }
        Update: {
          awarded_at?: string
          badge?: Database["public"]["Enums"]["badge_type"]
          contributor_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contributor_badges_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
        ]
      }
      contributors: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          github_username: string
          id: string
          intents_validated: number
          is_founding: boolean
          pr_count: number
          tier: Database["public"]["Enums"]["contributor_tier"]
          updated_at: string
          user_id: string | null
          xp: number
          yaml_kills: number
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          github_username: string
          id?: string
          intents_validated?: number
          is_founding?: boolean
          pr_count?: number
          tier?: Database["public"]["Enums"]["contributor_tier"]
          updated_at?: string
          user_id?: string | null
          xp?: number
          yaml_kills?: number
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          github_username?: string
          id?: string
          intents_validated?: number
          is_founding?: boolean
          pr_count?: number
          tier?: Database["public"]["Enums"]["contributor_tier"]
          updated_at?: string
          user_id?: string | null
          xp?: number
          yaml_kills?: number
        }
        Relationships: []
      }
      deployments: {
        Row: {
          created_at: string
          environment: string
          id: string
          plan_result: Json | null
          region: string
          stack_name: string
          status: string
          step_outputs: Json
          steps: Json
          updated_at: string
          user_id: string
          workload_type: string
        }
        Insert: {
          created_at?: string
          environment?: string
          id?: string
          plan_result?: Json | null
          region?: string
          stack_name?: string
          status?: string
          step_outputs?: Json
          steps?: Json
          updated_at?: string
          user_id: string
          workload_type?: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          plan_result?: Json | null
          region?: string
          stack_name?: string
          status?: string
          step_outputs?: Json
          steps?: Json
          updated_at?: string
          user_id?: string
          workload_type?: string
        }
        Relationships: []
      }
      metadata_cache: {
        Row: {
          cached_at: string
          id: string
          metadata: Json
          provider: Database["public"]["Enums"]["cloud_provider"]
          region: string
          resource_id: string
          resource_type: string
          ttl_seconds: number
          user_id: string
        }
        Insert: {
          cached_at?: string
          id?: string
          metadata: Json
          provider: Database["public"]["Enums"]["cloud_provider"]
          region: string
          resource_id: string
          resource_type: string
          ttl_seconds?: number
          user_id: string
        }
        Update: {
          cached_at?: string
          id?: string
          metadata?: Json
          provider?: Database["public"]["Enums"]["cloud_provider"]
          region?: string
          resource_id?: string
          resource_type?: string
          ttl_seconds?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          organization_id: string | null
          segment: Database["public"]["Enums"]["user_segment"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          organization_id?: string | null
          segment?: Database["public"]["Enums"]["user_segment"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          organization_id?: string | null
          segment?: Database["public"]["Enums"]["user_segment"]
          updated_at?: string
        }
        Relationships: []
      }
      provider_mappings: {
        Row: {
          expires_at: string | null
          id: string
          ingested_at: string
          mapping_data: Json
          provider: Database["public"]["Enums"]["cloud_provider"]
          service_name: string
          spec_hash: string
          spec_version: string
        }
        Insert: {
          expires_at?: string | null
          id?: string
          ingested_at?: string
          mapping_data: Json
          provider: Database["public"]["Enums"]["cloud_provider"]
          service_name: string
          spec_hash: string
          spec_version: string
        }
        Update: {
          expires_at?: string | null
          id?: string
          ingested_at?: string
          mapping_data?: Json
          provider?: Database["public"]["Enums"]["cloud_provider"]
          service_name?: string
          spec_hash?: string
          spec_version?: string
        }
        Relationships: []
      }
      user_credentials: {
        Row: {
          created_at: string
          encrypted_credentials: string
          id: string
          iv: string
          label: string
          provider: Database["public"]["Enums"]["cloud_provider"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_credentials: string
          id?: string
          iv: string
          label?: string
          provider: Database["public"]["Enums"]["cloud_provider"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_credentials?: string
          id?: string
          iv?: string
          label?: string
          provider?: Database["public"]["Enums"]["cloud_provider"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      yaml_bounties: {
        Row: {
          contributor_id: string
          created_at: string
          id: string
          is_featured: boolean
          legacy_config_type: string
          legacy_snippet: string
          month: string
          naawi_intent: string
          votes: number
        }
        Insert: {
          contributor_id: string
          created_at?: string
          id?: string
          is_featured?: boolean
          legacy_config_type: string
          legacy_snippet: string
          month: string
          naawi_intent: string
          votes?: number
        }
        Update: {
          contributor_id?: string
          created_at?: string
          id?: string
          is_featured?: boolean
          legacy_config_type?: string
          legacy_snippet?: string
          month?: string
          naawi_intent?: string
          votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "yaml_bounties_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "contributors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      badge_type:
        | "founder"
        | "yaml_slayer"
        | "intent_seeker"
        | "logic_builder"
        | "core_architect"
        | "bounty_winner"
      cloud_provider: "aws" | "gcp" | "azure" | "oci"
      contributor_tier: "intent" | "logic" | "core"
      user_segment: "free" | "developer" | "team" | "enterprise"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "moderator", "user"],
      badge_type: [
        "founder",
        "yaml_slayer",
        "intent_seeker",
        "logic_builder",
        "core_architect",
        "bounty_winner",
      ],
      cloud_provider: ["aws", "gcp", "azure"],
      contributor_tier: ["intent", "logic", "core"],
      user_segment: ["free", "developer", "team", "enterprise"],
    },
  },
} as const
