import { Composition } from "remotion";
import {
  DURATION_IN_FRAMES,
  FPS,
  ScientificCommitteeHero,
} from "./ScientificCommitteeHero";

export const Root = () => {
  return (
    <>
      <Composition
        id="ScientificCommitteeHero"
        component={ScientificCommitteeHero}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};