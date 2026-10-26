import { connection, NextResponse } from "next/server";

/**
 * AGPL-3.0 §13: users interacting with Spoter over a network must be offered its
 * source. Operators of modified versions point SOURCE_URL at their own code.
 */
export async function GET() {
  await connection();
  return NextResponse.redirect(
    process.env.SOURCE_URL || "https://github.com/BurgiSimon/spoter",
    307,
  );
}
