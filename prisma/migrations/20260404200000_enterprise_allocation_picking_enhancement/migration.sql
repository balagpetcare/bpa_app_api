-- DDL consolidated into 20260429120500_enterprise_allocation_post_foundation (runs after allocation_plans exist).
-- This migration previously ALTERed allocation_plans before the table was created, breaking shadow DB / fresh deploy.
SELECT 1;
