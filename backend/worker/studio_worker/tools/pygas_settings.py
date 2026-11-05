"""Typed source-bound graph settings. No expressions are evaluated."""
import math

def validate_settings(settings,schema):
 if schema.get('status')!='passed':return
 definitions={field['key']:field for field in schema['fields']}
 if 'opes' in settings:
  if not isinstance(settings['opes'],dict) or set(settings['opes'])-{name.removeprefix('opes.') for name in definitions if name.startswith('opes.')}:raise ValueError('Unknown or nonmapping OPES settings; use the actual source parameter list')
 for name,definition in definitions.items():
  if definition.get('location')=='graph.mode' or name=='mode':continue
  if name.startswith('opes.'):
   if name[5:] not in settings.get('opes',{}):continue
   value=settings['opes'][name[5:]]
  else:
   if name not in settings:continue
   value=settings[name]
  editor=definition.get('editor_hint',{});kind=editor.get('editor')
  if kind=='enum' and value not in editor.get('options',[]):raise ValueError(name+' is not an actual source option')
  if kind=='boolean' and type(value)is not bool:raise ValueError(name+' requires a literal boolean')
  if kind in ('integer','number','number_or_enum'):
   if kind=='number_or_enum' and value in editor.get('options',[]):continue
   if type(value) not in ((int,) if kind=='integer' else (int,float)) or not math.isfinite(value):raise ValueError(name+' requires a finite '+kind)
   if 'minimum' in editor and value<editor['minimum'] or 'exclusive_minimum' in editor and value<=editor['exclusive_minimum']:raise ValueError(name+' is outside the source-bound range')
  if kind in ('number_vector','vector_or_enum'):
   if kind=='vector_or_enum' and isinstance(value,str) and value in editor.get('options',[]):continue
   if value is None and definition.get('source_default') is None:continue
   if not isinstance(value,list) or any(type(v) not in (int,float) or not math.isfinite(v) for v in value):raise ValueError(name+' requires a finite ordered vector')
   if any('minimum' in editor and v<editor['minimum'] or 'exclusive_minimum' in editor and v<=editor['exclusive_minimum'] for v in value):raise ValueError(name+' vector values are outside the source-bound range')
  if kind=='enum_list' and (not isinstance(value,list) or not value or any(v not in editor.get('options',[]) for v in value) or len(value)!=len(set(value))):raise ValueError(name+' requires a nonempty unique list of source options')
 if settings.get('artifact_formats') and settings.get('deployment_backend') and settings['deployment_backend'] not in settings['artifact_formats']:raise ValueError('deployment_backend must belong to the explicitly selected artifact_formats')
 if str(settings.get('pt_path','')).endswith('.pt2') and (settings.get('deployment_backend')!='aoti' or 'aoti' not in settings.get('artifact_formats',[])):raise ValueError('Explicit .pt2 needs explicit matching AOTI settings; no backend fallback')
