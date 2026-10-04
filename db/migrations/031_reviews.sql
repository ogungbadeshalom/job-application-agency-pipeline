-- 031: reviews — client/external testimonials with admin moderation.
-- status: pending | approved | rejected. verified = has a user account (proven usage).
-- featured = hand-picked for the landing page headline row.
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,   -- null = external
  name text not null,
  role_label text,                                        -- e.g. 'Client since 2025', 'Data Engineer, US'
  stars int not null check (stars between 1 and 5),
  rating_communication int check (rating_communication between 1 and 5),
  rating_speed int check (rating_speed between 1 and 5),
  rating_results int check (rating_results between 1 and 5),
  body text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  verified boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  moderated_at timestamptz
);
create index if not exists reviews_status_idx on reviews(status);
