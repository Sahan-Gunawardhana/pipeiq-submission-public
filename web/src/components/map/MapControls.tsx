'use client';

import { useMap } from 'react-leaflet';
import { Plus, Minus, Hexagon, Component, Square, Circle, MapPin, Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import L from 'leaflet';

// Button Component for consistency
interface ControlButtonProps {
    onClick: () => void;
    icon: React.ReactNode;
    label?: string;
    isActive?: boolean;
    className?: string;
}

const ControlButton = ({ onClick, icon, label, isActive, className }: ControlButtonProps) => {
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={clsx(
                "w-9 h-9 flex items-center justify-center bg-white text-black transition-all duration-200 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 active:bg-gray-100",
                isActive && "bg-blue-50 text-blue-600",
                className
            )}
            title={label}
            type="button"
        >
            {icon}
        </button>
    );
};

// Container Component
const ControlContainer = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    return (
        <div className={clsx(
            "flex flex-col bg-white border border-gray-200 shadow-lg rounded-lg overflow-hidden",
            className
        )}>
            {children}
        </div>
    );
};

export const MapZoomControl = () => {
    const map = useMap();

    const handleZoomIn = () => {
        map.zoomIn();
    };

    const handleZoomOut = () => {
        map.zoomOut();
    };

    return (
        <ControlContainer>
            <ControlButton
                onClick={handleZoomIn}
                icon={<Plus size={18} />}
                label="Zoom In"
            />
            <ControlButton
                onClick={handleZoomOut}
                icon={<Minus size={18} />}
                label="Zoom Out"
            />
        </ControlContainer>
    );
};

// Types for Draw
type DrawMode = 'polyline' | 'polygon' | 'rectangle' | 'circle' | 'marker' | 'edit' | 'delete' | null;

export const MapDrawControl = ({ onModeChange, activeMode }: { onModeChange: (mode: DrawMode, handler: any) => void, activeMode: DrawMode }) => {
    return (
        <ControlContainer>
            <ControlButton
                onClick={() => onModeChange('polyline', L.Draw.Polyline)}
                icon={<Component size={18} />}
                label="Draw Polyline"
                isActive={activeMode === 'polyline'}
            />
            <ControlButton
                onClick={() => onModeChange('polygon', L.Draw.Polygon)}
                icon={<Hexagon size={18} />}
                label="Draw Polygon"
                isActive={activeMode === 'polygon'}
            />
            <ControlButton
                onClick={() => onModeChange('rectangle', L.Draw.Rectangle)}
                icon={<Square size={18} />}
                label="Draw Rectangle"
                isActive={activeMode === 'rectangle'}
            />
            <ControlButton
                onClick={() => onModeChange('circle', L.Draw.Circle)}
                icon={<Circle size={18} />}
                label="Draw Circle"
                isActive={activeMode === 'circle'}
            />
            <ControlButton
                onClick={() => onModeChange('marker', L.Draw.Marker)}
                icon={<MapPin size={18} />}
                label="Add Marker"
                isActive={activeMode === 'marker'}
            />
        </ControlContainer>
    );
};

export const MapEditControl = ({ onModeChange, activeMode, featureGroup }: { onModeChange: (mode: DrawMode, handler: any) => void, activeMode: DrawMode, featureGroup: L.FeatureGroup | null }) => {

    // We wrap the instantiation to pass featureGroup
    const getEditHandler = () => {
        if (!featureGroup) return null;
        // @ts-ignore
        return new L.EditToolbar.Edit(featureGroup.map, {
            featureGroup: featureGroup
        });
    };

    const getDeleteHandler = () => {
        if (!featureGroup) return null;
        // @ts-ignore
        return new L.EditToolbar.Delete(featureGroup.map, {
            featureGroup: featureGroup
        });
    };

    return (
        <ControlContainer>
            <ControlButton
                onClick={() => {
                    const handler = getEditHandler();
                    if (handler) onModeChange('edit', handler);
                }}
                icon={<Pencil size={18} />}
                label="Edit Layers"
                isActive={activeMode === 'edit'}
            />
            <ControlButton
                onClick={() => {
                    const handler = getDeleteHandler();
                    if (handler) onModeChange('delete', handler);
                }}
                icon={<Trash2 size={18} />}
                label="Delete Layers"
                isActive={activeMode === 'delete'}
            />
        </ControlContainer>
    );
};
