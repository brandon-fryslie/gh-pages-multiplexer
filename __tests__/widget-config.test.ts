import { describe, it, expect } from 'vitest';
import {
  parseWidgetPosition,
  validateWidgetColor,
  DEFAULT_WIDGET_POSITION,
  DEFAULT_WIDGET_COLOR,
} from '../src/widget-config.js';

describe('parseWidgetPosition', () => {
  it('parses "right 80%"', () => {
    expect(parseWidgetPosition('right 80%')).toEqual({ edge: 'right', vertical: '80%' });
  });

  it('parses "left 50%"', () => {
    expect(parseWidgetPosition('left 50%')).toEqual({ edge: 'left', vertical: '50%' });
  });

  it('parses with extra whitespace', () => {
    expect(parseWidgetPosition('  right   80%  ')).toEqual({ edge: 'right', vertical: '80%' });
  });

  it('empty string returns default', () => {
    expect(parseWidgetPosition('')).toEqual({ edge: 'right', vertical: '80%' });
  });

  it('rejects single token', () => {
    expect(() => parseWidgetPosition('right')).toThrow(/widget-position/);
  });

  it('rejects unknown edge', () => {
    expect(() => parseWidgetPosition('top 20%')).toThrow(/edge.*right.*left/);
  });

  it('rejects non-percentage vertical', () => {
    expect(() => parseWidgetPosition('right 80px')).toThrow(/percentage/);
  });

  it('rejects out-of-range percentage', () => {
    expect(() => parseWidgetPosition('right 150%')).toThrow(/between 0%/);
  });

  it('rejects three tokens', () => {
    expect(() => parseWidgetPosition('right 80% extra')).toThrow(/widget-position/);
  });

  it('default constant is parseable', () => {
    expect(() => parseWidgetPosition(DEFAULT_WIDGET_POSITION)).not.toThrow();
  });
});

describe('validateWidgetColor', () => {
  it('accepts #rrggbb', () => {
    expect(validateWidgetColor('#f97316')).toBe('#f97316');
  });

  it('accepts #rgb', () => {
    expect(validateWidgetColor('#fff')).toBe('#fff');
  });

  it('accepts #rrggbbaa', () => {
    expect(validateWidgetColor('#f9731680')).toBe('#f9731680');
  });

  it('accepts uppercase hex', () => {
    expect(validateWidgetColor('#ABCDEF')).toBe('#ABCDEF');
  });

  it('empty string passes through', () => {
    expect(validateWidgetColor('')).toBe('');
  });

  it('trims whitespace', () => {
    expect(validateWidgetColor('  #f97316  ')).toBe('#f97316');
  });

  it('rejects named color', () => {
    expect(() => validateWidgetColor('orange')).toThrow(/widget-color/);
  });

  it('rejects rgb() function', () => {
    expect(() => validateWidgetColor('rgb(255,0,0)')).toThrow(/widget-color/);
  });

  it('rejects missing #', () => {
    expect(() => validateWidgetColor('f97316')).toThrow(/widget-color/);
  });

  it('rejects wrong-length hex', () => {
    expect(() => validateWidgetColor('#f9731')).toThrow(/widget-color/);
  });

  it('default constant is valid', () => {
    expect(() => validateWidgetColor(DEFAULT_WIDGET_COLOR)).not.toThrow();
  });
});
