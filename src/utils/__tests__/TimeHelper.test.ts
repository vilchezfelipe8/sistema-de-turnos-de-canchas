import { TimeHelper } from '../TimeHelper';

describe('TimeHelper', () => {
  test('timeToMinutes and minutesToTime roundtrip', () => {
    expect(TimeHelper.timeToMinutes('00:00')).toBe(0);
    expect(TimeHelper.timeToMinutes('14:30')).toBe(870);
    expect(TimeHelper.minutesToTime(870)).toBe('14:30');
  });

  test('addMinutes valid', () => {
    expect(TimeHelper.addMinutes('14:00', 90)).toBe('15:30');
    expect(TimeHelper.addMinutes('09:15', 45)).toBe('10:00');
  });

  test('addMinutes overflow throws', () => {
    expect(() => TimeHelper.addMinutes('23:30', 60)).toThrow();
  });

  test('isOverlapping detects overlaps', () => {
    // A: 14:00-15:30, B:15:00-16:00 => overlap
    expect(TimeHelper.isOverlapping('14:00', '15:30', '15:00', '16:00')).toBe(true);
    // Non overlapping
    expect(TimeHelper.isOverlapping('10:00', '11:00', '11:00', '12:00')).toBe(false);
    // Touching edges
    expect(TimeHelper.isOverlapping('09:00', '10:00', '10:00', '11:00')).toBe(false);
  });
});

