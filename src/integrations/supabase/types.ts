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
      games: {
        Row: {
          camera_angle: Database["public"]["Enums"]["camera_angle"]
          created_at: string
          duration_seconds: number | null
          error: string | null
          game_date: string | null
          id: string
          opponent: string | null
          processing_cost_cents: number | null
          status: Database["public"]["Enums"]["game_status"]
          title: string
          updated_at: string
          user_id: string
          video_path: string | null
        }
        Insert: {
          camera_angle?: Database["public"]["Enums"]["camera_angle"]
          created_at?: string
          duration_seconds?: number | null
          error?: string | null
          game_date?: string | null
          id?: string
          opponent?: string | null
          processing_cost_cents?: number | null
          status?: Database["public"]["Enums"]["game_status"]
          title: string
          updated_at?: string
          user_id: string
          video_path?: string | null
        }
        Update: {
          camera_angle?: Database["public"]["Enums"]["camera_angle"]
          created_at?: string
          duration_seconds?: number | null
          error?: string | null
          game_date?: string | null
          id?: string
          opponent?: string | null
          processing_cost_cents?: number | null
          status?: Database["public"]["Enums"]["game_status"]
          title?: string
          updated_at?: string
          user_id?: string
          video_path?: string | null
        }
        Relationships: []
      }
      plays: {
        Row: {
          alternative: string | null
          confidence: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          duration_seconds: number | null
          end_seconds: number | null
          error: string | null
          flagged: boolean
          game_id: string | null
          id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["play_outcome"]
          possession_index: number | null
          share_id: string
          start_seconds: number | null
          status: Database["public"]["Enums"]["possession_status"]
          title: string | null
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
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          duration_seconds?: number | null
          end_seconds?: number | null
          error?: string | null
          flagged?: boolean
          game_id?: string | null
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["play_outcome"]
          possession_index?: number | null
          share_id?: string
          start_seconds?: number | null
          status?: Database["public"]["Enums"]["possession_status"]
          title?: string | null
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
          confidence?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          duration_seconds?: number | null
          end_seconds?: number | null
          error?: string | null
          flagged?: boolean
          game_id?: string | null
          id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["play_outcome"]
          possession_index?: number | null
          share_id?: string
          start_seconds?: number | null
          status?: Database["public"]["Enums"]["possession_status"]
          title?: string | null
          updated_at?: string
          uploader_role?: Database["public"]["Enums"]["uploader_role"]
          user_id?: string | null
          video_path?: string | null
          what_happened?: string | null
          what_went_right?: string | null
          what_went_wrong?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plays_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      camera_angle: "sideline" | "baseline" | "elevated" | "other"
      confidence_level: "low" | "medium" | "high"
      game_status: "uploading" | "processing" | "ready" | "failed"
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
      camera_angle: ["sideline", "baseline", "elevated", "other"],
      confidence_level: ["low", "medium", "high"],
      game_status: ["uploading", "processing", "ready", "failed"],
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
