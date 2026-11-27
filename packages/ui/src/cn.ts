import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** Custom font-size / shadow token names from tailwind-preset.cjs so tailwind-merge does not
 *  mistake `text-body-md` for a text colour (and drop `text-text-primary`). */
const FONT_SIZES = [
  'display-hero', 'headline-lg', 'headline-lg-mobile', 'headline-md', 'headline-sm', 'body-lg', 'body-md',
  'body-sm', 'label-lg', 'label-md', 'label-sm', 'caption',
];
const SHADOWS = [
  'elevation-1', 'elevation-2', 'elevation-3', 'elevation-4', 'card-hover', 'header', 'bevel-primary',
  'bevel-primary-active', 'bevel-success', 'bevel-danger', 'bevel-warning', 'bevel-neutral', 'row-accent',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
      shadow: [{ shadow: SHADOWS }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
