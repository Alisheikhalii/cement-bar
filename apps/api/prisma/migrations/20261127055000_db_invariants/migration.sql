-- Critical invariants enforced by the database itself (GUIDELINES §2).
-- Applied as a hand-written migration after the Prisma-generated init migration.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- BR-06: at most ONE active reservation per load unit.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_unit
  ON reservations ("unitId")
  WHERE status IN ('RESERVED','ARRIVED','LOADED','EXITED','CANCEL_REQUESTED');

-- BR-09: at most one PENDING cancel request per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS cancel_requests_one_pending
  ON cancel_requests ("reservationId")
  WHERE status = 'PENDING';

-- BR-F1: a driver can be in at most one group membership at any date.
ALTER TABLE bulk_group_members
  ADD CONSTRAINT bulk_group_members_no_overlap
  EXCLUDE USING gist (
    "driverId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[)') WITH &&
  );

-- At most one active vehicle per driver.
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_active_per_driver
  ON vehicles ("driverId") WHERE active;

-- Sanity checks
ALTER TABLE bag_priorities ADD CONSTRAINT bag_priorities_rank_1_3 CHECK (rank BETWEEN 1 AND 3);
ALTER TABLE announcements ADD CONSTRAINT announcements_truck_count_pos CHECK ("truckCount" > 0);
ALTER TABLE announcements ADD CONSTRAINT announcements_weight_range CHECK ("weightToKg" >= "weightFromKg" AND "weightFromKg" >= 0);
ALTER TABLE announcements ADD CONSTRAINT announcements_cargo_value_nonneg CHECK ("cargoValue" >= 0);
ALTER TABLE carrier_quotas ADD CONSTRAINT carrier_quotas_nonneg CHECK ("tonnageLimitKg" >= 0);

-- Append-only tables (audit_logs, queue_events).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS queue_events_append_only ON queue_events;
CREATE TRIGGER queue_events_append_only BEFORE UPDATE OR DELETE ON queue_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS queue_events_no_truncate ON queue_events;
CREATE TRIGGER queue_events_no_truncate BEFORE TRUNCATE ON queue_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
