export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'akogan.dev/photo-pipeline' },
    });
    const data = await res.json();
    return (
      data.address?.city ??
      data.address?.town ??
      data.address?.village ??
      data.address?.country ??
      null
    );
  } catch {
    return null;
  }
}
