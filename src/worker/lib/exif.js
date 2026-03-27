import exifr from 'exifr';

export async function extractExif(buffer) {
  try {
    const raw = await exifr.parse(buffer, {
      pick: [
        'DateTimeOriginal',
        'Orientation',
        'GPSLatitude',
        'GPSLongitude',
        'FocalLengthIn35mmFormat',
        'FNumber',
        'ExposureTime',
        'ISO',
      ],
    });

    if (!raw) return {};

    const result = {};

    if (raw.DateTimeOriginal) {
      result.dateTaken = raw.DateTimeOriginal.toISOString();
    }
    if (raw.Orientation) {
      result.orientation = raw.Orientation;
    }
    if (raw.GPSLatitude != null && raw.GPSLongitude != null) {
      result.gps = { lat: raw.GPSLatitude, lng: raw.GPSLongitude };
    }

    const hasCamera = raw.FocalLengthIn35mmFormat || raw.FNumber || raw.ExposureTime || raw.ISO;
    if (hasCamera) {
      result.camera = {
        focal:    raw.FocalLengthIn35mmFormat ? `${raw.FocalLengthIn35mmFormat}mm` : null,
        aperture: raw.FNumber ? `f/${raw.FNumber}` : null,
        shutter:  raw.ExposureTime ? formatShutter(raw.ExposureTime) : null,
        iso:      raw.ISO ?? null,
      };
    }

    return result;
  } catch {
    return {};
  }
}

function formatShutter(value) {
  if (value >= 1) return `${value}s`;
  return `1/${Math.round(1 / value)}s`;
}
