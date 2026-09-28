-- Migration 0028: Harden remove_portfolio_media(UUID) execute grants.
--
-- Migration 0027 created the secure 1-arg function with SECURITY DEFINER
-- and granted EXECUTE to authenticated, but did not explicitly revoke the
-- default PUBLIC privilege. Since anon inherits from PUBLIC, anon_execute
-- remained true. The function body checks auth.uid() internally so this
-- was not a privilege escalation, but it violated least privilege and the
-- declared contract.
--
-- Fix: explicitly revoke from PUBLIC and anon, re-grant to authenticated.
-- No change to the function body or signature.

REVOKE EXECUTE ON FUNCTION public.remove_portfolio_media(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_portfolio_media(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_portfolio_media(UUID) TO authenticated;