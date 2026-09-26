"""Point-in-time universe reconstruction.

The universe on 2019-03-14 is the set of instruments that were listed and
tradable ON that date — including the ones that have since been delisted. Using
today's listings is survivorship bias, and it is the single easiest way to make
a strategy look good that never existed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from ...db import fetch_all


@dataclass(slots=True)
class UniverseMember:
    instrument_id: str
    issuer_id: str
    ticker: str
    sector_code: str | None
    listing_status: str
    listing_date: date | None
    delisting_date: date | None
    median_turnover: Decimal | None


def reconstruct(
    as_of: date,
    *,
    min_median_turnover: Decimal | None = None,
    liquidity_window: int = 60,
    exclude_states: tuple[str, ...] = ("suspended", "halted", "delisted"),
) -> list[UniverseMember]:
    """Rebuild the eligible universe as it existed on `as_of`."""
    rows = fetch_all(
        """
        with liquidity as (
          select
            b.instrument_id,
            percentile_cont(0.5) within group (order by b.turnover) as median_turnover
          from market_bars b
          where b.session_date <= :as_of
            and b.session_date > (cast(:as_of as date) - make_interval(days => :window_days))
            and b.adjustment_basis = 'raw'
            and b.quality <> 'unavailable'
          group by b.instrument_id
        ),
        status as (
          select distinct on (ts.instrument_id)
                 ts.instrument_id, ts.state
            from trading_status ts
           where ts.session_date <= :as_of
           order by ts.instrument_id, ts.session_date desc
        )
        select
          i.id::text              as instrument_id,
          i.issuer_id::text       as issuer_id,
          i.ticker,
          iss.sector_code,
          i.listing_status,
          i.listing_date,
          i.delisting_date,
          l.median_turnover,
          coalesce(s.state, 'normal') as trading_state
        from instruments i
        join issuers iss on iss.id = i.issuer_id
        left join liquidity l on l.instrument_id = i.id
        left join status   s on s.instrument_id = i.id
        where
          -- listed on or before the date ...
          (i.listing_date is null or i.listing_date <= :as_of)
          -- ... and not yet delisted on that date (delisted names STAY in the
          -- historical universe up to their delisting)
          and (i.delisting_date is null or i.delisting_date > :as_of)
          and i.valid_from <= :as_of_ts
          and (i.valid_to is null or i.valid_to > :as_of_ts)
        """,
        as_of=as_of,
        as_of_ts=f"{as_of} 23:59:59+00",
        window_days=liquidity_window * 2,  # calendar days ≈ 2× sessions
    )

    members: list[UniverseMember] = []
    for r in rows:
        if r.get("trading_state") in exclude_states:
            continue
        median = r.get("median_turnover")
        median_dec = Decimal(str(median)) if median is not None else None
        if min_median_turnover is not None and (median_dec is None or median_dec < min_median_turnover):
            continue
        members.append(
            UniverseMember(
                instrument_id=r["instrument_id"],
                issuer_id=r["issuer_id"],
                ticker=r["ticker"],
                sector_code=r.get("sector_code"),
                listing_status=r["listing_status"],
                listing_date=r.get("listing_date"),
                delisting_date=r.get("delisting_date"),
                median_turnover=median_dec,
            )
        )
    return members


def trading_calendar(start: date, end: date) -> list[date]:
    rows = fetch_all(
        """
        select session_date
          from market_calendar
         where is_trading_day = true
           and session_date between :start and :end
         order by session_date
        """,
        start=start,
        end=end,
    )
    if rows:
        return [r["session_date"] for r in rows]
    # Fall back to sessions we actually have bars for, rather than inventing a
    # calendar. A missing calendar is a data gap, not a licence to assume.
    rows = fetch_all(
        """
        select distinct session_date
          from market_bars
         where session_date between :start and :end
         order by session_date
        """,
        start=start,
        end=end,
    )
    return [r["session_date"] for r in rows]
