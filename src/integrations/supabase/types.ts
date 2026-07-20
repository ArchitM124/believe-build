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
      plays: {
        Row: {
          alternative: string | null
          attack_direction: string | null
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          declared_outcome: string | null
          duration_seconds: number | null
          end_seconds: number | null
          error: string | null
          flagged: boolean
          game_type: string | null
          id: string
          kind: string
          notes: string | null
          outcome: Database["public"]["Enums"]["play_outcome"]
          player_stats: Json | null
          possession_index: number | null
          share_id: string
          start_seconds: number | null
          status: Database["public"]["Enums"]["possession_status"]
          team_color: string | null
          title: string | null
          tracked_player: string | null
          updated_at: string
          uploader_role: Database["public"]["Enums"]["uploader_role"]
          user_id: string | null
          video_path: string | null
          what_happened: string | null
          what_went_right: string | null
          what_went_wrong: string | null
        }
        Insert: {
          alternative?: string | null
          attack_direction?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          declared_outcome?: string | null
          duration_seconds?: number | null
          end_seconds?: number | null
          error?: string | null
          flagged?: boolean
          game_type?: string | null
          id?: string
          kind?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["play_outcome"]
          player_stats?: Json | null
          possession_index?: number | null
          share_id?: string
          start_seconds?: number | null
          status?: Database["public"]["Enums"]["possession_status"]
          team_color?: string | null
          title?: string | null
          tracked_player?: string | null
          updated_at?: string
          uploader_role?: Database["public"]["Enums"]["uploader_role"]
          user_id?: string | null
          video_path?: string | null
          what_happened?: string | null
          what_went_right?: string | null
          what_went_wrong?: string | null
        }
        Update: {
          alternative?: string | null
          attack_direction?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          declared_outcome?: string | null
          duration_seconds?: number | null
          end_seconds?: number | null
          error?: string | null
          flagged?: boolean
          game_type?: string | null
          id?: string
          kind?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["play_outcome"]
          player_stats?: Json | null
          possession_index?: number | null
          share_id?: string
          start_seconds?: number | null
          status?: Database["public"]["Enums"]["possession_status"]
          team_color?: string | null
          title?: string | null
          tracked_player?: string | null
          updated_at?: string
          uploader_role?: Database["public"]["Enums"]["uploader_role"]
          user_id?: string | null
          video_path?: string | null
          what_happened?: string | null
          what_went_right?: string | null
          what_went_wrong?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          team_name: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          team_name?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          team_name?: string | null
        }
        Relationships: []
      }
      ratings: {
        Row: {
          created_at: string
          id: string
          overall: number
          play_ids: string[]
          possessions_used: number
          report: Json | null
          sub_scores: Json
          tracked_player: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          overall: number
          play_ids: string[]
          possessions_used: number
          report?: Json | null
          sub_scores: Json
          tracked_player: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          overall?: number
          play_ids?: string[]
          possessions_used?: number
          report?: Json | null
          sub_scores?: Json
          tracked_player?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_shared_possession: {
        Args: { p_share_id: string }
        Returns: {
          alternative: string
          confidence: Database["public"]["Enums"]["confidence_level"]
          duration_seconds: number
          id: string
          outcome: Database["public"]["Enums"]["play_outcome"]
          share_id: string
          title: string
          what_happened: string
          what_went_right: string
          what_went_wrong: string
        }[]
      }
    }
    Enums: {
      confidence_level: "low" | "medium" | "high"
      play_outcome:
        | "made_shot"
        | "missed_shot"
        | "turnover"
        | "defensive_stop"
        | "defensive_breakdown"
        | "foul"
        | "other"
      possession_status: "uploading" | "processing" | "ready" | "failed"
      uploader_role: "coach" | "player"
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
      confidence_level: ["low", "medium", "high"],
      play_outcome: [
        "made_shot",
        "missed_shot",
        "turnover",
        "defensive_stop",
        "defensive_breakdown",
        "foul",
        "other",
      ],
      possession_status: ["uploading", "processing", "ready", "failed"],
      uploader_role: ["coach", "player"],
    },
  },
} as const
