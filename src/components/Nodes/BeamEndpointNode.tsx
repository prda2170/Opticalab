// Invisible phantom node used as the far endpoint of unobstructed beam rays.
// Renders nothing visible — exists only so xyflow can attach a beam edge to it.
// The Handle is required; without it React Flow skips rendering edges to this node.
import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

const BeamEndpointNode: React.FC = () => (
  <Handle
    type="target"
    position={Position.Left}
    id="in"
    style={{ opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, background: 'transparent', border: 'none' }}
  />
);

export default memo(BeamEndpointNode);
