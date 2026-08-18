/* Minimal typed view of the existing Supabase schema, matching the migrations
   applied in Phase 2, Phase A, and the committee members migration. Kept
   small by design — expand as tables are added. Replaces the library's
   untyped `any` default for the public schema. */
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          email?: string | null;
          username?: string;
          role?: "student" | "contributor" | "admin" | "owner";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string | null;
          username?: string;
          role?: "student" | "contributor" | "admin" | "owner";
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
    };
    Enums: {
      user_role: "student" | "contributor" | "admin" | "owner";
    };
  };
};
