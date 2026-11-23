CREATE SCHEMA IF NOT EXISTS stagepass;
REVOKE ALL ON SCHEMA stagepass FROM PUBLIC;
SET LOCAL search_path TO stagepass;
CREATE TABLE IF NOT EXISTS users (
 id serial PRIMARY KEY, name text UNIQUE NOT NULL, password text NOT NULL,
 role text NOT NULL CHECK(role IN ('attendee','organizer','admin')), guest boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sessions (
 token text PRIMARY KEY, owner integer NOT NULL REFERENCES users, expires double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id serial PRIMARY KEY, name text NOT NULL, venue text NOT NULL, date double precision NOT NULL,
 rows integer NOT NULL CHECK(rows BETWEEN 1 AND 26), cols integer NOT NULL CHECK(cols BETWEEN 1 AND 36),
 minutes integer NOT NULL DEFAULT 5 CHECK(minutes BETWEEN 1 AND 60),
 maximum integer NOT NULL DEFAULT 4 CHECK(maximum BETWEEN 1 AND rows*cols), genre text NOT NULL DEFAULT 'Live event'
);
CREATE TABLE IF NOT EXISTS reservations (
 id serial PRIMARY KEY, event integer NOT NULL REFERENCES events, owner integer NOT NULL REFERENCES users,
 status text NOT NULL CHECK(status IN ('held','booked','cancelled','expired')), seats text[] NOT NULL,
 expires double precision, UNIQUE(id,event)
);
CREATE TABLE IF NOT EXISTS claims (
 event integer NOT NULL, seat text NOT NULL, reservation integer NOT NULL,
 PRIMARY KEY(event,seat), FOREIGN KEY(reservation,event) REFERENCES reservations(id,event)
);
CREATE INDEX IF NOT EXISTS reservation_owner ON reservations(owner);
CREATE INDEX IF NOT EXISTS reservation_expiry ON reservations(expires) WHERE status='held';

-- Earlier installations have the original two-role constraint.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='stagepass.users'::regclass
            AND conname='users_role_check' AND position('''admin''' in pg_get_constraintdef(oid))=0) THEN
   ALTER TABLE users DROP CONSTRAINT users_role_check;
   ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('attendee','organizer','admin'));
 END IF;
END $$;

-- Send a data-free signal after committed changes. Each browser fetches its own authorized view.
CREATE OR REPLACE FUNCTION stagepass.notify_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_notify('stagepass_change', '');
 RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER event_change AFTER INSERT OR UPDATE OR DELETE ON events
 FOR EACH ROW EXECUTE FUNCTION stagepass.notify_change();
CREATE OR REPLACE TRIGGER reservation_change AFTER INSERT OR UPDATE OR DELETE ON reservations
 FOR EACH ROW EXECUTE FUNCTION stagepass.notify_change();
CREATE OR REPLACE TRIGGER claim_change AFTER INSERT OR UPDATE OR DELETE ON claims
 FOR EACH ROW EXECUTE FUNCTION stagepass.notify_change();
CREATE OR REPLACE TRIGGER account_created AFTER INSERT ON users
 FOR EACH ROW WHEN (NOT NEW.guest) EXECUTE FUNCTION stagepass.notify_change();
CREATE OR REPLACE TRIGGER account_changed AFTER UPDATE OR DELETE ON users
 FOR EACH ROW WHEN (NOT OLD.guest) EXECUTE FUNCTION stagepass.notify_change();

ALTER TABLE stagepass.users ADD COLUMN IF NOT EXISTS google_subject text;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_subject ON stagepass.users(google_subject);
