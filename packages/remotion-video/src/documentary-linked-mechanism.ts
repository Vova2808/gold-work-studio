import type {DocumentaryLinkedMechanism} from '@gold-work/shared';

/** The slider axis, wrist pin, rod and crank pin share exact joint coordinates. */
export function sliderCrankPose(mechanism: DocumentaryLinkedMechanism, progress: number, moving = true) {
  const angle = ((mechanism.startAngle ?? 0) + (moving ? Math.max(0, Math.min(1, progress)) * (mechanism.turns ?? 1) * 360 : 270)) * Math.PI / 180;
  const {centerX, centerY, crankRadius: radius, rodLength: length} = mechanism;
  const crankPin = {x: centerX + radius * Math.sin(angle), y: centerY - radius * Math.cos(angle)};
  const wristPin = {x: centerX, y: centerY - radius * Math.cos(angle) - Math.sqrt(length * length - radius * radius * Math.sin(angle) ** 2)};
  return {angle, center: {x: centerX, y: centerY}, crankPin, wristPin,
    piston: {x: centerX - mechanism.pistonWidth / 2, y: wristPin.y - mechanism.pistonHeight * .58,
      width: mechanism.pistonWidth, height: mechanism.pistonHeight}};
}

/** Full-stroke envelope, including optional cues, for one scene-wide fit. */
export function sliderCrankBounds(mechanism: DocumentaryLinkedMechanism) {
  const {centerX, centerY, crankRadius: r, rodLength: length, pistonWidth: width, pistonHeight: height} = mechanism;
  const halfWidth = Math.max(width / 2 + 20 + (mechanism.annotations?.reciprocatingForce ? 40 : 0),
    r + 23, mechanism.annotations?.crankTorque ? r + 47 : 0);
  const top = Math.min(centerY - r - length - height * .58 - 24,
    mechanism.annotations?.crankTorque ? centerY - r - 47 : Infinity);
  const bottom = Math.max(centerY + r + 23, centerY + r - length + height * .42 + 24);
  return {x: centerX - halfWidth, y: top, w: halfWidth * 2, h: bottom - top};
}
