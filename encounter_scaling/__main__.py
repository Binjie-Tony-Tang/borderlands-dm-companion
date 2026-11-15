"""CLI for approved attendance calculations: python -m encounter_scaling."""

import argparse
from dataclasses import asdict
import json

from .hp import scale_fixed_count_hp
from .count import scale_weaker_group
from .targets import scale_target_cap
from .areas import scale_area


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calculate count/HP and optional approved target-cap or area scaling."
    )
    parser.add_argument("--hp", required=True, type=int,
                        help="Original official per-creature maximum HP")
    parser.add_argument("--players", required=True, type=int, choices=range(4, 9))
    parser.add_argument("--count", type=int, default=1,
                        help="Original printed creature count (default: 1)")
    parser.add_argument("--profile", choices=("fixed", "weaker"), default="fixed",
                        help="Prepared group profile (default: fixed)")
    parser.add_argument("--targets", type=int,
                        help="Original cap of one approved fixed-profile ability (not Multiattack)")
    parser.add_argument("--area", choices=("cone", "line", "circle", "emanation", "sweep"))
    parser.add_argument("--distance", type=int, help="Original area length/radius/reach in feet")
    parser.add_argument("--width", type=int, help="Original line width in feet (unchanged)")
    parser.add_argument("--sweep-angle", type=int, choices=(180, 360))
    args = parser.parse_args()
    if args.targets is not None and args.profile == "weaker":
        parser.error("--targets applies only to fixed-profile abilities; weaker abilities stay printed")
    if args.area is not None:
        if args.profile == "weaker":
            parser.error("area scaling applies only to fixed-profile abilities")
        if args.targets is not None:
            parser.error("choose numeric targets or area for this ability, not both")
        if args.distance is None:
            parser.error("--area requires --distance")
    elif any(v is not None for v in (args.distance, args.width, args.sweep_angle)):
        parser.error("area dimensions require --area")
    try:
        scale = scale_weaker_group if args.profile == "weaker" else scale_fixed_count_hp
        result = scale(args.hp, args.players, creature_count=args.count)
        output = asdict(result)
        if args.targets is not None:
            output["target_scaling"] = asdict(scale_target_cap(args.targets, args.players))
        if args.area is not None:
            output["area_scaling"] = asdict(scale_area(
                args.area, args.distance, args.players,
                width_feet=args.width, sweep_angle=args.sweep_angle,
            ))
    except (TypeError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
