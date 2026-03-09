import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

interface DndProviderWrapperProps {
  children: React.ReactNode;
}

export default function DndProviderWrapper({ children }: DndProviderWrapperProps) {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
