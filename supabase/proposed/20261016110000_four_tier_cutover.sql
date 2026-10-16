-- Four-tier release, stage 2 (NOT APPLIED; run at release, together with deploying the new site). Owner approval
-- required (production release).
-- Makes Free / Flash / Bolt / Thunder the public lineup and retires Plus and Pro from it. Plus and Pro stay as rows:
-- a subscription row or usage record that names them keeps its reference. The new site lists plans by tier and does
-- not depend on this flag; it only matters to older builds that still list plans with active = true.
-- Undo: update public.billing_plans set active = (key in ('free', 'plus', 'pro'));
update public.billing_plans set active = (key in ('free', 'flash', 'bolt', 'thunder'));
