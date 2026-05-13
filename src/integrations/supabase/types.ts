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
      agent_settings: {
        Row: {
          blocked_keywords: string[]
          id: string
          is_paused: boolean
          max_clips_per_day: number
          min_score_threshold: number
          updated_at: string
        }
        Insert: {
          blocked_keywords?: string[]
          id?: string
          is_paused?: boolean
          max_clips_per_day?: number
          min_score_threshold?: number
          updated_at?: string
        }
        Update: {
          blocked_keywords?: string[]
          id?: string
          is_paused?: boolean
          max_clips_per_day?: number
          min_score_threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          clip_id: string | null
          created_at: string
          details: Json | null
          id: string
        }
        Insert: {
          action: string
          clip_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
        }
        Update: {
          action?: string
          clip_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          budget_remaining: number | null
          budget_total: number | null
          created_at: string
          earnings: number | null
          id: string
          name: string
          payout_rate: string | null
          platform: string | null
          requirements: string | null
          status: string
        }
        Insert: {
          budget_remaining?: number | null
          budget_total?: number | null
          created_at?: string
          earnings?: number | null
          id?: string
          name: string
          payout_rate?: string | null
          platform?: string | null
          requirements?: string | null
          status?: string
        }
        Update: {
          budget_remaining?: number | null
          budget_total?: number | null
          created_at?: string
          earnings?: number | null
          id?: string
          name?: string
          payout_rate?: string | null
          platform?: string | null
          requirements?: string | null
          status?: string
        }
        Relationships: []
      }
      chat_velocity: {
        Row: {
          baseline_msgs_per_sec: number | null
          clip_id: string | null
          created_at: string
          id: string
          is_spike: boolean
          msgs_per_sec: number
          peak_window: string | null
          sample_messages: Json | null
          source_id: string
          spike_ratio: number | null
        }
        Insert: {
          baseline_msgs_per_sec?: number | null
          clip_id?: string | null
          created_at?: string
          id?: string
          is_spike?: boolean
          msgs_per_sec: number
          peak_window?: string | null
          sample_messages?: Json | null
          source_id: string
          spike_ratio?: number | null
        }
        Update: {
          baseline_msgs_per_sec?: number | null
          clip_id?: string | null
          created_at?: string
          id?: string
          is_spike?: boolean
          msgs_per_sec?: number
          peak_window?: string | null
          sample_messages?: Json | null
          source_id?: string
          spike_ratio?: number | null
        }
        Relationships: []
      }
      clips: {
        Row: {
          approved_at: string | null
          chat_spike_ratio: number | null
          created_at: string
          duration_seconds: number | null
          hook_caption: string | null
          id: string
          kick_clip_id: string | null
          kick_clip_url: string | null
          kick_view_count: number | null
          matched_velocity_id: string | null
          platforms: Json
          rendered_video_url: string | null
          score_breakdown: Json | null
          score_rationale: string | null
          source_id: string | null
          status: string
          stream_timestamp: string | null
          thumbnail_url: string | null
          title: string | null
          video_url: string | null
          virality_score: number | null
        }
        Insert: {
          approved_at?: string | null
          chat_spike_ratio?: number | null
          created_at?: string
          duration_seconds?: number | null
          hook_caption?: string | null
          id?: string
          kick_clip_id?: string | null
          kick_clip_url?: string | null
          kick_view_count?: number | null
          matched_velocity_id?: string | null
          platforms?: Json
          rendered_video_url?: string | null
          score_breakdown?: Json | null
          score_rationale?: string | null
          source_id?: string | null
          status?: string
          stream_timestamp?: string | null
          thumbnail_url?: string | null
          title?: string | null
          video_url?: string | null
          virality_score?: number | null
        }
        Update: {
          approved_at?: string | null
          chat_spike_ratio?: number | null
          created_at?: string
          duration_seconds?: number | null
          hook_caption?: string | null
          id?: string
          kick_clip_id?: string | null
          kick_clip_url?: string | null
          kick_view_count?: number | null
          matched_velocity_id?: string | null
          platforms?: Json
          rendered_video_url?: string | null
          score_breakdown?: Json | null
          score_rationale?: string | null
          source_id?: string | null
          status?: string
          stream_timestamp?: string | null
          thumbnail_url?: string | null
          title?: string | null
          video_url?: string | null
          virality_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clips_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      download_history: {
        Row: {
          clip_id: string | null
          downloaded_at: string
          format: string | null
          id: string
        }
        Insert: {
          clip_id?: string | null
          downloaded_at?: string
          format?: string | null
          id?: string
        }
        Update: {
          clip_id?: string | null
          downloaded_at?: string
          format?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_history_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
        ]
      }
      render_jobs: {
        Row: {
          clip_id: string
          completed_at: string | null
          created_at: string
          duration_sec: number | null
          error_message: string | null
          id: string
          output_url: string | null
          provider: string
          provider_render_id: string | null
          start_offset_sec: number | null
          status: string
          vod_url: string | null
        }
        Insert: {
          clip_id: string
          completed_at?: string | null
          created_at?: string
          duration_sec?: number | null
          error_message?: string | null
          id?: string
          output_url?: string | null
          provider?: string
          provider_render_id?: string | null
          start_offset_sec?: number | null
          status?: string
          vod_url?: string | null
        }
        Update: {
          clip_id?: string
          completed_at?: string | null
          created_at?: string
          duration_sec?: number | null
          error_message?: string | null
          id?: string
          output_url?: string | null
          provider?: string
          provider_render_id?: string | null
          start_offset_sec?: number | null
          status?: string
          vod_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "render_jobs_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          avg_viewers: number | null
          created_at: string
          display_name: string
          follower_count: number | null
          id: string
          is_monitoring: boolean
          last_known_live: boolean
          last_polled_at: string | null
          poll_interval_min: number
          slug: string
          spike_sensitivity: number
        }
        Insert: {
          avg_viewers?: number | null
          created_at?: string
          display_name: string
          follower_count?: number | null
          id?: string
          is_monitoring?: boolean
          last_known_live?: boolean
          last_polled_at?: string | null
          poll_interval_min?: number
          slug: string
          spike_sensitivity?: number
        }
        Update: {
          avg_viewers?: number | null
          created_at?: string
          display_name?: string
          follower_count?: number | null
          id?: string
          is_monitoring?: boolean
          last_known_live?: boolean
          last_polled_at?: string | null
          poll_interval_min?: number
          slug?: string
          spike_sensitivity?: number
        }
        Relationships: []
      }
      templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          settings: Json
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
