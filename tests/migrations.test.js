import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
test("Google migration preserves legacy participants, referrals, coupons and orders; revokes only legacy credentials", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("migrations/001_referrals.sql", "utf8"));
    const owner = "11111111-1111-4111-8111-111111111111",
      friend = "22222222-2222-4222-8222-222222222222",
      order = "33333333-3333-4333-8333-333333333333";
    await db.query(
      "INSERT INTO participants(id,email,identity_hash,code,approved,confirmed,redeemed) VALUES($1,$2,$3,$4,true,true,true)",
      [owner, "legacy@example.com", "legacy-hash", "legacy-code"],
    );
    await db.query(
      "INSERT INTO participants(id,email,identity_hash,code,referrer,confirmed,approved) VALUES($1,$2,$3,$4,$5,true,true)",
      [friend, "friend@example.com", "friend-hash", "friend-code", owner],
    );
    await db.query(
      "INSERT INTO coupons VALUES('RFA-PRESERVED',$1,30,now()+interval '30 days',false)",
      [owner],
    );
    await db.query(
      "INSERT INTO orders(id,participant,coupon,snapshot,expires_at) VALUES($1,$2,'RFA-PRESERVED',$3,now()+interval '30 minutes')",
      [order, owner, JSON.stringify({ total: 6993 })],
    );
    await db.query(
      "INSERT INTO sessions VALUES('old-session',$1,now()+interval '7 days')",
      [owner],
    );
    await db.query(
      "INSERT INTO tokens VALUES('old-token',$1,now()+interval '15 minutes',false)",
      [owner],
    );
    await db.exec(readFileSync("migrations/002_google_identity.sql", "utf8"));
    const p = (
      await db.query("SELECT * FROM participants WHERE id=$1", [owner])
    ).rows[0];
    assert.equal(p.email, "legacy@example.com");
    assert.equal(p.redeemed, true);
    assert.equal(p.google_sub_hash, null);
    assert.equal(
      (
        await db.query("SELECT referrer FROM participants WHERE id=$1", [
          friend,
        ])
      ).rows[0].referrer,
      owner,
    );
    assert.equal((await db.query("SELECT * FROM coupons")).rows[0].percent, 30);
    assert.equal(
      (await db.query("SELECT * FROM orders")).rows[0].snapshot.total,
      6993,
    );
    assert.equal(
      Number(
        (await db.query("SELECT count(*) FROM participant_contacts")).rows[0]
          .count,
      ),
      2,
    );
    assert.equal(
      (await db.query("SELECT expires_at<=now() AS expired FROM sessions"))
        .rows[0].expired,
      true,
    );
    assert.equal(
      (await db.query("SELECT expires_at<=now() AS expired FROM tokens"))
        .rows[0].expired,
      true,
    );
  } finally {
    await db.close();
  }
});
