-- Favorite members (MBJ-220, Premium): a member picks people to highlight in a color in every chat and comment
-- section. Kept if Premium lapses (they just stop highlighting until the member resubscribes).

-- Up Migration

CREATE TABLE user_favorites (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  favorite_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  color       TEXT NOT NULL CHECK (color IN ('red', 'orange', 'yellow', 'lime', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, favorite_id),
  CHECK (user_id <> favorite_id)
);

-- Down Migration

DROP TABLE IF EXISTS user_favorites;
