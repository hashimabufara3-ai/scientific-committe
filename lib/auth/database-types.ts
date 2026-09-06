/* Minimal typed view of the existing Supabase schema, matching the migrations
   applied in Phase 2, Phase A, committee members, and Phase 2A (account
   system foundation). Kept small by design — expand as tables are added.
   Replaces the library's untyped `any` default for the public schema. */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string | null;
          username: string;
          role: "student" | "contributor" | "admin" | "owner";
          must_change_password: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          email?: string | null;
          username?: string;
          role?: "student" | "contributor" | "admin" | "owner";
          must_change_password?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string | null;
          username?: string;
          role?: "student" | "contributor" | "admin" | "owner";
          must_change_password?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      committee_members: {
        Row: {
          id: string;
          user_id: string | null;
          name_ar: string;
          name_en: string;
          major_ar: string;
          major_en: string;
          role_ar: string;
          role_en: string;
          gender: "male" | "female";
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name_ar: string;
          name_en: string;
          major_ar: string;
          major_en: string;
          role_ar: string;
          role_en: string;
          gender: "male" | "female";
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          name_ar?: string;
          name_en?: string;
          major_ar?: string;
          major_en?: string;
          role_ar?: string;
          role_en?: string;
          gender?: "male" | "female";
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      committee_member_private: {
        Row: {
          committee_member_id: string;
          father_name: string;
        };
        Insert: {
          committee_member_id: string;
          father_name?: string;
        };
        Update: {
          committee_member_id?: string;
          father_name?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_email: string | null;
          action: string;
          target_type: string;
          target_id: string | null;
          details: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          actor_email?: string | null;
          action: string;
          target_type: string;
          target_id?: string | null;
          details?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          actor_email?: string | null;
          action?: string;
          target_type?: string;
          target_id?: string | null;
          details?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [];
      };
      subjects: {
        Row: {
          id: string;
          title: string;
          title_ar: string | null;
          category: string | null;
          author_id: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          title_ar?: string | null;
          category?: string | null;
          author_id: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          title_ar?: string | null;
          category?: string | null;
          author_id?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      summaries: {
        Row: {
          id: string;
          subject_id: string;
          title: string;
          title_ar: string | null;
          description: string | null;
          description_ar: string | null;
          source: "upload" | "content";
          content: string | null;
          videos: string[];
          storage_path: string | null;
          file_name: string | null;
          mime_type: string | null;
          file_size: number | null;
          file_url: string | null;
          file_size_label: string | null;
          pages: number | null;
          external_resources: Record<string, unknown>[];
          author_id: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          subject_id: string;
          title: string;
          title_ar?: string | null;
          description?: string | null;
          description_ar?: string | null;
          source?: "upload" | "content";
          content?: string | null;
          videos?: string[];
          storage_path?: string | null;
          file_name?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          file_url?: string | null;
          file_size_label?: string | null;
          pages?: number | null;
          external_resources?: Record<string, unknown>[];
          author_id: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          subject_id?: string;
          title?: string;
          title_ar?: string | null;
          description?: string | null;
          description_ar?: string | null;
          source?: "upload" | "content";
          content?: string | null;
          videos?: string[];
          storage_path?: string | null;
          file_name?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          file_url?: string | null;
          file_size_label?: string | null;
          pages?: number | null;
          external_resources?: Record<string, unknown>[];
          author_id?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      exam_files: {
        Row: {
          id: string;
          subject_id: string;
          type: "midterm" | "final";
          year: string | null;
          semester: "first" | "second" | "summer" | null;
          storage_path: string;
          file_name: string;
          mime_type: string | null;
          file_size: number | null;
          file_url: string | null;
          author_id: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          subject_id: string;
          type: "midterm" | "final";
          year?: string | null;
          semester?: "first" | "second" | "summer" | null;
          storage_path: string;
          file_name: string;
          mime_type?: string | null;
          file_size?: number | null;
          file_url?: string | null;
          author_id: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          subject_id?: string;
          type?: "midterm" | "final";
          year?: string | null;
          semester?: "first" | "second" | "summer" | null;
          storage_path?: string;
          file_name?: string;
          mime_type?: string | null;
          file_size?: number | null;
          file_url?: string | null;
          author_id?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      contributor_activity: {
        Row: {
          id: string;
          actor_id: string;
          action: "subject" | "summary" | "exam" | "edit" | "delete";
          title_en: string | null;
          title_ar: string | null;
          exam_type: "midterm" | "final" | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id: string;
          action: "subject" | "summary" | "exam" | "edit" | "delete";
          title_en?: string | null;
          title_ar?: string | null;
          exam_type?: "midterm" | "final" | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string;
          action?: "subject" | "summary" | "exam" | "edit" | "delete";
          title_en?: string | null;
          title_ar?: string | null;
          exam_type?: "midterm" | "final" | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_role: {
        Args: Record<PropertyKey, never>;
        Returns: "student" | "contributor" | "admin" | "owner" | null;
      };
      assign_role: {
        Args: {
          target: string;
          new_role: "student" | "contributor" | "admin" | "owner";
        };
        Returns: undefined;
      };
      transfer_ownership: {
        Args: {
          target: string;
        };
        Returns: undefined;
      };
      admin_delete_user: {
        Args: {
          p_user_id: string;
        };
        Returns: undefined;
      };
      admin_list_members: {
        Args: {
          search?: string;
        };
        Returns: {
          id: string;
          full_name: string;
          username: string;
          role: "student" | "contributor" | "admin" | "owner";
          created_at: string;
        }[];
      };
      username_available: {
        Args: {
          p_username: string;
        };
        Returns: boolean;
      };
      resolve_auth_email: {
        Args: {
          p_identifier: string;
        };
        Returns: string | null;
      };
      admin_list_committee_members: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          user_id: string | null;
          name_ar: string;
          name_en: string;
          major_ar: string;
          major_en: string;
          role_ar: string;
          role_en: string;
          gender: "male" | "female";
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }[];
      };
      admin_get_committee_member: {
        Args: { p_id: string };
        Returns: {
          id: string;
          user_id: string | null;
          name_ar: string;
          name_en: string;
          major_ar: string;
          major_en: string;
          role_ar: string;
          role_en: string;
          gender: "male" | "female";
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        }[];
      };
      admin_create_committee_member: {
        Args: {
          p_user_id?: string | null;
          p_name_ar: string;
          p_name_en: string;
          p_major_ar: string;
          p_major_en: string;
          p_role_ar: string;
          p_role_en: string;
          p_gender: "male" | "female";
          p_sort_order?: number;
          p_is_active?: boolean;
        };
        Returns: string;
      };
      admin_update_committee_member: {
        Args: {
          p_id: string;
          p_user_id?: string | null;
          p_name_ar: string;
          p_name_en: string;
          p_major_ar: string;
          p_major_en: string;
          p_role_ar: string;
          p_role_en: string;
          p_gender: "male" | "female";
          p_sort_order: number;
          p_is_active: boolean;
        };
        Returns: undefined;
      };
      admin_delete_committee_member: {
        Args: { p_id: string };
        Returns: undefined;
      };
      public_list_committee_members: {
        Args: Record<PropertyKey, never>;
        Returns: {
          name: string;
          role: string;
          major: string;
          gender: string;
        }[];
      };
      log_audit_event: {
        Args: {
          p_action: string;
          p_target_type: string;
          p_target_id?: string;
          p_details?: Record<string, unknown>;
        };
        Returns: undefined;
      };
      admin_create_committee_member_private: {
        Args: {
          p_committee_member_id: string;
          p_father_name?: string;
        };
        Returns: undefined;
      };
      set_must_change_password: {
        Args: {
          p_user_id: string;
          p_must_change: boolean;
        };
        Returns: undefined;
      };
      clear_must_change_password: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      create_subject: {
        Args: {
          p_title: string;
          p_title_ar?: string | null;
          p_category?: string | null;
        };
        Returns: string;
      };
      update_subject: {
        Args: {
          p_id: string;
          p_title: string;
          p_title_ar?: string | null;
          p_category?: string | null;
        };
        Returns: undefined;
      };
      delete_subject: {
        Args: { p_id: string };
        Returns: undefined;
      };
      delete_subject_with_storage: {
        Args: { p_id: string };
        Returns: { storage_path: string | null }[];
      };
      create_subject_with_summary: {
        Args: {
          p_title: string;
          p_title_ar?: string | null;
          p_category?: string | null;
          p_summary_title: string;
          p_summary_title_ar?: string | null;
          p_summary_description?: string | null;
          p_summary_description_ar?: string | null;
          p_summary_source?: string;
          p_summary_content?: string | null;
          p_summary_videos?: string[];
          p_summary_storage_path?: string | null;
          p_summary_file_name?: string | null;
          p_summary_mime_type?: string | null;
          p_summary_file_size?: number | null;
          p_exam_type?: string | null;
          p_exam_year?: string | null;
          p_exam_semester?: string | null;
          p_exam_storage_path?: string | null;
          p_exam_file_name?: string | null;
          p_exam_mime_type?: string | null;
          p_exam_file_size?: number | null;
        };
        Returns: string;
      };
      create_summary: {
        Args: {
          p_subject_id: string;
          p_title: string;
          p_title_ar?: string | null;
          p_description?: string | null;
          p_description_ar?: string | null;
          p_source?: string;
          p_content?: string | null;
          p_videos?: string[];
          p_storage_path?: string | null;
          p_file_name?: string | null;
          p_mime_type?: string | null;
          p_file_size?: number | null;
          p_file_url?: string | null;
          p_file_size_label?: string | null;
          p_pages?: number | null;
          p_external_resources?: Record<string, unknown>[];
        };
        Returns: string;
      };
      update_summary: {
        Args: {
          p_id: string;
          p_title: string;
          p_title_ar?: string | null;
          p_description?: string | null;
          p_description_ar?: string | null;
          p_source?: string;
          p_content?: string | null;
          p_videos?: string[];
          p_storage_path?: string | null;
          p_file_name?: string | null;
          p_mime_type?: string | null;
          p_file_size?: number | null;
          p_file_url?: string | null;
          p_file_size_label?: string | null;
          p_pages?: number | null;
          p_external_resources?: Record<string, unknown>[];
        };
        Returns: undefined;
      };
      delete_summary: {
        Args: { p_id: string };
        Returns: undefined;
      };
      create_exam: {
        Args: {
          p_subject_id: string;
          p_type: "midterm" | "final";
          p_year?: string | null;
          p_semester?: string | null;
          p_storage_path: string;
          p_file_name: string;
          p_mime_type?: string | null;
          p_file_size?: number | null;
          p_file_url?: string | null;
        };
        Returns: string;
      };
      update_exam: {
        Args: {
          p_id: string;
          p_type: "midterm" | "final";
          p_year?: string | null;
          p_semester?: string | null;
          p_storage_path?: string | null;
          p_file_name?: string | null;
          p_mime_type?: string | null;
          p_file_size?: number | null;
          p_file_url?: string | null;
        };
        Returns: undefined;
      };
      delete_exam: {
        Args: { p_id: string };
        Returns: undefined;
      };
      record_contributor_activity: {
        Args: {
          p_action: "subject" | "summary" | "exam" | "edit" | "delete";
          p_kind: "subject" | "summary" | "exam";
          p_id: string;
        };
        Returns: undefined;
      };
      recent_contributor_activity: {
        Args: {
          p_limit?: number;
        };
        Returns: {
          id: string;
          is_own: boolean;
          actor_name_en: string | null;
          actor_name_ar: string | null;
          action: "subject" | "summary" | "exam" | "edit" | "delete";
          title_en: string | null;
          title_ar: string | null;
          exam_type: "midterm" | "final" | null;
          created_at: string;
        }[];
      };
    };
    Enums: {
      user_role: "student" | "contributor" | "admin" | "owner";
    };
  };
};
