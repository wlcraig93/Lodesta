import type { AssetReference, BusinessProfile, Vertical } from "./models";

export type RegistryImageAsset = AssetReference & {
  vertical: Vertical;
  width: number;
  height: number;
  usageScope: "preclaim_preview" | "published_site";
  licenseNote: string;
  label: string;
};

const registry: Record<Vertical, RegistryImageAsset[]> = {
  restaurant: [
    asset("restaurant", "restaurant_hero_pizza", "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1600&q=80", "Pizza coming out of a restaurant oven", "Menu photography"),
    asset("restaurant", "restaurant_tacos", "https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=1200&q=80", "Fresh tacos on a restaurant table", "Signature dishes"),
    asset("restaurant", "restaurant_dining_room", "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1200&q=80", "Warm restaurant dining room ready for guests", "Dining room")
  ],
  auto_body: [
    asset("auto_body", "auto_body_ai_lift_bay_overview_hero", "/generated-site-assets/auto-body/lift-bay-overview-v1.png", "Generic unbranded vehicle raised on a two-post lift inside an anonymous auto body shop bay", "Lift bay overview", "generated"),
    asset("auto_body", "auto_body_ai_finished_panel_review", "/generated-site-assets/auto-body/finished-shop-review-v1.png", "Finished repaired vehicle side panel with clean body lines in an anonymous shop bay", "Finished body-panel review", "generated"),
    asset("auto_body", "auto_body_ai_collision_disassembly", "/generated-site-assets/auto-body/collision-disassembly-v1.png", "Generic front bumper cover removed for collision repair with parts organized in an anonymous shop bay", "Collision disassembly", "generated"),
    asset("auto_body", "auto_body_ai_paint_booth_masked_panel", "/generated-site-assets/auto-body/paint-booth-masked-panel-v1.png", "Masked generic vehicle panel in a paint booth ready for refinishing", "Paint booth prep", "generated"),
    asset("auto_body", "auto_body_ai_paint_prep_sanding_block", "/generated-site-assets/auto-body/paint-prep-sanding-block-v1.png", "Gloved hand safely using a manual sanding block on a masked vehicle body panel", "Paint prep sanding", "generated"),
    asset("auto_body", "auto_body_ai_pdr_reflection_panel", "/generated-site-assets/auto-body/pdr-reflection-panel-v1.png", "Paintless dent repair inspection with small hail dents and reflection light board on a generic vehicle side panel", "Paintless dent repair", "generated"),
    asset("auto_body", "auto_body_ai_before_after_panel_view", "/generated-site-assets/auto-body/before-after-body-panel-v2.png", "Generic before-and-after vehicle side-panel repair comparison without labels or business identity", "Before-and-after panel view", "generated"),
    asset("auto_body", "auto_body_ai_windshield_replacement", "/generated-site-assets/auto-body/windshield-replacement-v1.png", "Generic windshield replacement alignment using safe suction-cup tools in an anonymous shop bay", "Windshield replacement", "generated"),
    asset("auto_body", "auto_body_ai_replacement_glass_stand", "/generated-site-assets/auto-body/replacement-glass-stand-v1.png", "Replacement windshield glass staged on a padded stand beside a generic vehicle", "Replacement glass staged", "generated"),
    asset("auto_body", "auto_body_ai_windshield_chip_repair", "/generated-site-assets/auto-body/windshield-chip-repair-v1.png", "Windshield rock chip repair close-up with resin injector bridge and no hands visible", "Windshield chip repair", "generated"),
    asset("auto_body", "auto_body_ai_bumper_prep_stand", "/generated-site-assets/auto-body/bumper-prep-stand-v1.png", "Detached generic bumper cover on a padded stand with sanded primer repair area", "Bumper repair prep", "generated"),
    asset("auto_body", "auto_body_ai_panel_gap_inspection", "/generated-site-assets/auto-body/panel-gap-inspection-v1.png", "Finished vehicle front quarter-panel gap and body-line inspection detail in an anonymous shop bay", "Panel gap inspection", "generated"),
    asset("auto_body", "auto_body_ai_frame_bench_measure", "/generated-site-assets/auto-body/frame-bench-measure-v1.png", "Generic vehicle secured on a frame bench for structural collision repair in an anonymous shop bay", "Frame bench measuring", "generated"),
    asset("auto_body", "auto_body_ai_pickup_bedside_prep", "/generated-site-assets/auto-body/pickup-bedside-prep-v1.png", "Generic pickup bedside panel masked with primer repair prep and no brand identity", "Pickup bedside prep", "generated"),
    asset("auto_body", "auto_body_ai_suv_quarter_primer", "/generated-site-assets/auto-body/suv-quarter-primer-v1.png", "Generic SUV quarter panel masked with feathered primer repair area", "SUV quarter-panel primer", "generated"),
    asset("auto_body", "auto_body_ai_bumper_fender_alignment", "/generated-site-assets/auto-body/bumper-fender-alignment-v1.png", "Generic bumper cover and fender alignment detail after collision repair", "Bumper and fender alignment", "generated"),
    asset("auto_body", "auto_body_ai_headlight_pocket_repair", "/generated-site-assets/auto-body/headlight-pocket-repair-v1.png", "Generic headlight pocket and mounting bracket repair detail with bumper removed", "Headlight pocket repair", "generated"),
    asset("auto_body", "auto_body_ai_rocker_scuff_repair", "/generated-site-assets/auto-body/rocker-scuff-repair-v1.png", "Generic rocker-panel scuff repair prep with masking and primer", "Rocker scuff repair", "generated"),
    asset("auto_body", "auto_body_ai_hail_hood_reflection", "/generated-site-assets/auto-body/hail-hood-reflection-v1.png", "Generic hail-dented hood inspection with reflection lighting and no people", "Hail hood inspection", "generated"),
    asset("auto_body", "auto_body_ai_pdr_glue_tabs", "/generated-site-assets/auto-body/pdr-glue-tabs-v1.png", "Paintless dent repair glue-pull tabs on a generic vehicle panel with no hands visible", "PDR glue-pull tabs", "generated"),
    asset("auto_body", "auto_body_ai_windshield_urethane_bead", "/generated-site-assets/auto-body/windshield-urethane-bead-v1.png", "Generic windshield opening with a fresh urethane bead along the pinch weld", "Windshield urethane bead", "generated"),
    asset("auto_body", "auto_body_ai_side_window_regulator", "/generated-site-assets/auto-body/side-window-regulator-v1.png", "Generic side window glass and regulator repair detail with door trim removed", "Side window regulator", "generated"),
    asset("auto_body", "auto_body_ai_body_tools_flat_lay", "/generated-site-assets/auto-body/body-tools-flat-lay-v1.png", "Unbranded auto body metalwork tools arranged on a worn shop workbench", "Body tools flat lay", "generated"),
    asset("auto_body", "auto_body_ai_primer_sanded_texture", "/generated-site-assets/auto-body/primer-sanded-texture-v1.png", "Primer and sanded paint surface texture on a generic vehicle body panel", "Primer sanding texture", "generated"),
    asset("auto_body", "auto_body_ai_body_env_frame_rack_wide", "/generated-site-assets/auto-body/body-env-frame-rack-wide-v1.png", "Wide generic frame rack bay for structural collision repair in an anonymous auto body shop", "Wide frame rack bay", "generated"),
    asset("auto_body", "auto_body_ai_body_env_paint_prep_bay", "/generated-site-assets/auto-body/body-env-paint-prep-bay-v1.png", "Generic masked vehicle in a wide paint prep bay with primer repair area", "Paint prep bay", "generated"),
    asset("auto_body", "auto_body_ai_body_env_inspection_bay", "/generated-site-assets/auto-body/body-env-inspection-bay-v1.png", "Generic damage-inspection bay with reflection light stand and no paperwork", "Damage inspection bay", "generated"),
    asset("auto_body", "auto_body_ai_body_env_pickup_frame_bench", "/generated-site-assets/auto-body/body-env-pickup-frame-bench-v1.png", "Generic pickup body secured on a frame bench with wheels cropped out", "Pickup frame bench", "generated"),
    asset("auto_body", "auto_body_ai_body_env_parts_cart_bay", "/generated-site-assets/auto-body/body-env-parts-cart-bay-v1.png", "Organized collision disassembly parts cart in an anonymous body shop bay", "Parts cart bay", "generated"),
    asset("auto_body", "auto_body_ai_body_env_panel_stand_row", "/generated-site-assets/auto-body/body-env-panel-stand-row-v1.png", "Detached generic body panels and bumper covers on padded stands", "Panel stand row", "generated"),
    asset("auto_body", "auto_body_ai_body_env_shop_floor_wide", "/generated-site-assets/auto-body/body-env-shop-floor-wide-v1.png", "Wide anonymous auto body shop floor with panel stands and prep equipment", "Wide body-shop floor", "generated"),
    asset("auto_body", "auto_body_ai_body_env_masked_booth_wide", "/generated-site-assets/auto-body/body-env-masked-booth-wide-v1.png", "Generic masked vehicle in a paint booth from a wider alternate angle", "Masked booth wide", "generated"),
    asset("auto_body", "auto_body_ai_body_env_dusk_bay_interior", "/generated-site-assets/auto-body/body-env-dusk-bay-interior-v1.png", "Anonymous auto body bay interior at dusk with no exterior signage", "Dusk bay interior", "generated"),
    asset("auto_body", "auto_body_ai_body_env_wheel_free_suv_quarter", "/generated-site-assets/auto-body/body-env-wheel-free-suv-quarter-v1.png", "Wheel-free generic SUV quarter-panel repair bay with masked and primed repair area", "Wheel-free SUV quarter repair", "generated"),
    asset("auto_body", "auto_body_ai_collision_rear_quarter_disassembly", "/generated-site-assets/auto-body/collision-rear-quarter-disassembly-v1.png", "Generic rear quarter-panel collision disassembly with bumper and tail light removed", "Rear quarter disassembly", "generated"),
    asset("auto_body", "auto_body_ai_collision_tailgate_panel_prep", "/generated-site-assets/auto-body/collision-tailgate-panel-prep-v1.png", "Generic tailgate panel on padded stand with sanded primer repair area", "Tailgate panel prep", "generated"),
    asset("auto_body", "auto_body_ai_collision_door_shell_alignment", "/generated-site-assets/auto-body/collision-door-shell-alignment-v1.png", "Generic door shell and hinge alignment detail after collision repair", "Door shell alignment", "generated"),
    asset("auto_body", "auto_body_ai_collision_radiator_support_measure", "/generated-site-assets/auto-body/collision-radiator-support-measure-v1.png", "Generic front support measuring detail with bumper removed and scale turned away", "Radiator support measure", "generated"),
    asset("auto_body", "auto_body_ai_collision_parts_cart_fasteners", "/generated-site-assets/auto-body/collision-parts-cart-fasteners-v1.png", "Collision repair fasteners and brackets organized in plain bins on a parts cart", "Collision fasteners cart", "generated"),
    asset("auto_body", "auto_body_ai_collision_front_bracket_alignment", "/generated-site-assets/auto-body/collision-front-bracket-alignment-v1.png", "Plain front corner mounting bracket aligned on a generic vehicle front apron", "Front bracket alignment", "generated"),
    asset("auto_body", "auto_body_ai_paint_masking_tape_edge", "/generated-site-assets/auto-body/paint-masking-tape-edge-v1.png", "Clean masking tape edge and primer feathering on a generic body panel", "Masking tape edge", "generated"),
    asset("auto_body", "auto_body_ai_paint_primer_feathering", "/generated-site-assets/auto-body/paint-primer-feathering-v1.png", "Gray primer patch feathered smoothly into a generic painted body panel", "Primer feathering", "generated"),
    asset("auto_body", "auto_body_ai_paint_seam_sealer_bead", "/generated-site-assets/auto-body/paint-seam-sealer-bead-v1.png", "Smooth seam sealer bead applied along an interior body-panel seam", "Seam sealer bead", "generated"),
    asset("auto_body", "auto_body_ai_paint_wet_sanding_block", "/generated-site-assets/auto-body/paint-wet-sanding-block-v1.png", "Safe manual wet-sanding block used on a masked generic body panel", "Wet sanding block", "generated"),
    asset("auto_body", "auto_body_ai_paint_panel_rack_booth", "/generated-site-assets/auto-body/paint-panel-rack-booth-v1.png", "Detached unbranded panels on padded stands inside a clean paint booth", "Paint booth panel rack", "generated"),
    asset("auto_body", "auto_body_ai_paint_mixing_cup_unlabeled", "/generated-site-assets/auto-body/paint-mixing-cup-unlabeled-v1.png", "Unlabeled paint mixing cup and stir sticks on a plain body-shop bench", "Unlabeled paint mixing", "generated"),
    asset("auto_body", "auto_body_ai_pdr_door_ding_reflection", "/generated-site-assets/auto-body/pdr-door-ding-reflection-v1.png", "Small door ding visible through reflection-light distortion on a generic side panel", "Door ding reflection", "generated"),
    asset("auto_body", "auto_body_ai_pdr_hood_dent_reflection", "/generated-site-assets/auto-body/pdr-hood-dent-reflection-v1.png", "Shallow hood dents visible through reflection-light lines with no marker writing", "Hood dent reflection", "generated"),
    asset("auto_body", "auto_body_ai_scratch_clearcoat_scuff", "/generated-site-assets/auto-body/scratch-clearcoat-scuff-v1.png", "Light clearcoat scratches and scuff repair prep on a generic body panel", "Clearcoat scuff repair", "generated"),
    asset("auto_body", "auto_body_ai_dent_door_edge_reflection", "/generated-site-assets/auto-body/dent-door-edge-reflection-v1.png", "Subtle dent near a generic door edge and character line", "Door edge dent reflection", "generated"),
    asset("auto_body", "auto_body_ai_pdr_rod_behind_panel", "/generated-site-assets/auto-body/pdr-rod-behind-panel-v1.png", "Paintless dent repair access rod positioned behind a removed door trim panel", "PDR rod behind panel", "generated"),
    asset("auto_body", "auto_body_ai_hail_roof_rail_reflection", "/generated-site-assets/auto-body/hail-roof-rail-reflection-v1.png", "Shallow hail dents near a roof rail revealed by simple reflection lines", "Hail roof-rail reflection", "generated"),
    asset("auto_body", "auto_body_ai_pdr_glue_pull_tabs", "/generated-site-assets/auto-body/pdr-glue-pull-tabs-v1.png", "Plain paintless dent glue-pull tabs attached to a shallow dent area", "PDR glue-pull tabs", "generated"),
    asset("auto_body", "auto_body_ai_dent_crease_reflection", "/generated-site-assets/auto-body/dent-crease-reflection-v1.png", "Shallow crease dent across a body line visible through reflection lighting", "Crease dent reflection", "generated"),
    asset("auto_body", "auto_body_ai_body_glass_rear_window_stand", "/generated-site-assets/auto-body/body-glass-rear-window-stand-v1.png", "Generic rear window replacement glass safely supported on a padded stand", "Rear glass staged", "generated"),
    asset("auto_body", "auto_body_ai_body_glass_quarter_window_install", "/generated-site-assets/auto-body/body-glass-quarter-window-install-v1.png", "Supported quarter window glass aligned near a generic body opening", "Quarter window install", "generated"),
    asset("auto_body", "auto_body_ai_body_glass_pinch_weld_cleaned", "/generated-site-assets/auto-body/body-glass-pinch-weld-cleaned-v1.png", "Clean windshield pinch weld channel before glass installation", "Cleaned pinch weld", "generated"),
    asset("auto_body", "auto_body_ai_body_glass_door_window_track", "/generated-site-assets/auto-body/body-glass-door-window-track-v1.png", "Door glass guide rail and regulator fasteners inside a generic door shell", "Door window track", "generated"),
    asset("auto_body", "auto_body_ai_body_glass_cowl_masked", "/generated-site-assets/auto-body/body-glass-cowl-masked-v1.png", "Windshield cowl area masked for glass and body repair", "Masked windshield cowl", "generated"),
    asset("auto_body", "auto_body_ai_body_glass_side_glass_cleanup", "/generated-site-assets/auto-body/body-glass-side-glass-cleanup-v1.png", "Tempered side-glass fragments collected safely in a plain lined tray", "Side-glass cleanup", "generated"),
    asset("auto_body", "auto_body_ai_bumper_tab_repair_closeup", "/generated-site-assets/auto-body/bumper-tab-repair-closeup-v1.png", "Plastic bumper tab repair close-up on a detached generic bumper cover", "Bumper tab repair", "generated"),
    asset("auto_body", "auto_body_ai_bumper_lower_valance_scuff", "/generated-site-assets/auto-body/bumper-lower-valance-scuff-v1.png", "Lower bumper valance scuff repair prep with gray primer patch", "Lower valance scuff", "generated"),
    asset("auto_body", "auto_body_ai_rocker_panel_primer_edge", "/generated-site-assets/auto-body/rocker-panel-primer-edge-v1.png", "Rocker panel masked and sanded with gray primer edge", "Rocker primer edge", "generated"),
    asset("auto_body", "auto_body_ai_trim_clip_flat_lay", "/generated-site-assets/auto-body/trim-clip-flat-lay-v1.png", "Unbranded plastic trim clips and fasteners on a plain work mat", "Trim clip flat lay", "generated"),
    asset("auto_body", "auto_body_ai_fender_liner_fastener_detail", "/generated-site-assets/auto-body/fender-liner-fastener-detail-v1.png", "Plastic fender liner edge and plain push-fastener repair detail", "Fender liner fastener", "generated"),
    asset("auto_body", "auto_body_ai_finished_panel_reflection_review", "/generated-site-assets/auto-body/finished-panel-reflection-review-v1.png", "Finished generic side panel with smooth reflection lines and clean body line", "Finished panel reflection", "generated"),
    asset("auto_body", "auto_body_ai_finished_door_gap_review", "/generated-site-assets/auto-body/finished-door-gap-review-v1.png", "Finished door and fender gap review detail on a generic vehicle", "Finished door gap", "generated"),
    asset("auto_body", "auto_body_ai_before_after_quarter_panel", "/generated-site-assets/auto-body/before-after-quarter-panel-v1.png", "Generic non-claim quarter-panel repair comparison without text labels", "Quarter-panel comparison", "generated"),
    asset("auto_body", "auto_body_ai_finished_bumper_fitment", "/generated-site-assets/auto-body/finished-bumper-fitment-v1.png", "Finished bumper and fender fitment review with clean even seams", "Finished bumper fitment", "generated"),
    asset("auto_body", "auto_body_ai_custom_paint_spray_cards", "/generated-site-assets/auto-body/custom-paint-spray-cards-v1.png", "Unmarked custom paint spray-out cards on a plain body-shop bench", "Custom paint spray cards", "generated"),
    asset("auto_body", "auto_body_ai_custom_paint_masked_accent_panel", "/generated-site-assets/auto-body/custom-paint-masked-accent-panel-v1.png", "Detached generic body panel with clean masking for a simple accent paint layout", "Masked accent panel", "generated"),
    asset("auto_body", "auto_body_ai_custom_paint_clearcoat_sample", "/generated-site-assets/auto-body/custom-paint-clearcoat-sample-v1.png", "Unmarked painted sample panel showing glossy clearcoat reflection on a padded stand", "Clearcoat sample panel", "generated")
  ],
  auto_services: [
    asset("auto_services", "auto_services_ai_env_two_post_lift_bay", "/generated-site-assets/auto-services/env-two-post-lift-bay-v1.png", "Generic unbranded vehicle safely raised on a two-post lift inside an anonymous auto service bay", "Two-post lift service bay", "generated"),
    asset("auto_services", "auto_services_ai_env_hood_open_service_bay", "/generated-site-assets/auto-services/env-hood-open-service-bay-v1.png", "Generic unbranded vehicle with hood open inside an anonymous auto repair bay", "Hood-open service bay", "generated"),
    asset("auto_services", "auto_services_ai_env_wheel_off_rotor_bay", "/generated-site-assets/auto-services/env-wheel-off-rotor-bay-v1.png", "Generic vehicle on lift with one wheel removed and brake rotor visible in an anonymous service bay", "Wheel-off rotor bay", "generated"),
    asset("auto_services", "auto_services_ai_env_alignment_rack", "/generated-site-assets/auto-services/env-alignment-rack-v1.png", "Generic vehicle on an alignment rack with screens out of view in an anonymous service bay", "Alignment rack bay", "generated"),
    asset("auto_services", "auto_services_ai_env_tire_inventory_wall", "/generated-site-assets/auto-services/env-tire-inventory-wall-v1.png", "Unbranded tire inventory wall inside an anonymous tire and auto service shop", "Tire inventory wall", "generated"),
    asset("auto_services", "auto_services_ai_env_tire_cart_bay", "/generated-site-assets/auto-services/env-tire-cart-bay-v1.png", "Plain tire cart holding unbranded tires near an anonymous service bay", "Tire cart bay", "generated"),
    asset("auto_services", "auto_services_ai_env_quick_lube_bay", "/generated-site-assets/auto-services/env-quick-lube-bay-v1.png", "Generic oil service bay with hood-open vehicle and clean drain pan context", "Quick-lube service bay", "generated"),
    asset("auto_services", "auto_services_ai_env_battery_diagnostic_bay", "/generated-site-assets/auto-services/env-battery-diagnostic-bay-v1.png", "Generic hood-open vehicle with battery diagnostic cart and no readable display", "Battery diagnostic bay", "generated"),
    asset("auto_services", "auto_services_ai_env_empty_service_bays", "/generated-site-assets/auto-services/env-empty-service-bays-v1.png", "Clean empty auto service bays with safe lift arms and no vehicles or signage", "Empty service bays", "generated"),
    asset("auto_services", "auto_services_ai_env_wide_toolbench", "/generated-site-assets/auto-services/env-wide-toolbench-v1.png", "Unbranded auto service tools and hardware arranged on a worn workbench", "Auto service toolbench", "generated"),
    asset("auto_services", "auto_services_ai_env_blurred_lift_bay", "/generated-site-assets/auto-services/env-blurred-lift-bay-v1.png", "Softly blurred anonymous lift bay background for generic auto service context", "Blurred lift bay", "generated"),
    asset("auto_services", "auto_services_ai_env_blurred_tire_rack", "/generated-site-assets/auto-services/env-blurred-tire-rack-v1.png", "Softly blurred tire rack and workbench background for generic auto service context", "Blurred tire rack", "generated"),
    asset("auto_services", "auto_services_ai_tire_interior_patch", "/generated-site-assets/auto-services/tire-interior-patch-v1.png", "Interior tire patch repair detail with roller tool on an unbranded tire", "Interior tire patch", "generated"),
    asset("auto_services", "auto_services_ai_tire_tread_macro", "/generated-site-assets/auto-services/tire-tread-macro-v1.png", "Fresh tire tread macro texture with no readable sidewall markings", "Fresh tire tread", "generated"),
    asset("auto_services", "auto_services_ai_tire_tread_depth_check", "/generated-site-assets/auto-services/tire-tread-depth-check-v1.png", "Tread-depth check with gauge markings turned away from the camera", "Tread-depth check", "generated"),
    asset("auto_services", "auto_services_ai_tire_valve_stem", "/generated-site-assets/auto-services/tire-valve-stem-v1.png", "Generic valve stem service detail on an unbranded wheel rim", "Valve stem service", "generated"),
    asset("auto_services", "auto_services_ai_tire_tpms_flat_lay", "/generated-site-assets/auto-services/tire-tpms-flat-lay-v1.png", "Unbranded TPMS sensor and valve parts arranged on a plain work mat", "TPMS parts flat lay", "generated"),
    asset("auto_services", "auto_services_ai_tire_wheel_balancing_spindle", "/generated-site-assets/auto-services/tire-wheel-balancing-spindle-v1.png", "Unbranded wheel mounted on a balancing spindle with screens out of frame", "Wheel balancing spindle", "generated"),
    asset("auto_services", "auto_services_ai_tire_adhesive_wheel_weights", "/generated-site-assets/auto-services/tire-adhesive-wheel-weights-v1.png", "Adhesive wheel balancing weights inside a plain rim barrel", "Adhesive wheel weights", "generated"),
    asset("auto_services", "auto_services_ai_tire_rotation_set", "/generated-site-assets/auto-services/tire-rotation-set-v1.png", "Four loose unbranded tires staged for tire rotation or changeover", "Tire rotation set", "generated"),
    asset("auto_services", "auto_services_ai_tire_pressure_gauge", "/generated-site-assets/auto-services/tire-pressure-gauge-v1.png", "Tire pressure gauge connected to a valve stem with gauge face turned away", "Tire pressure check", "generated"),
    asset("auto_services", "auto_services_ai_tire_used_inspection", "/generated-site-assets/auto-services/tire-used-inspection-v1.png", "Used tire tread inspection with shop light and no sidewall text visible", "Used tire inspection", "generated"),
    asset("auto_services", "auto_services_ai_tire_wheel_studs_cleaned", "/generated-site-assets/auto-services/tire-wheel-studs-cleaned-v1.png", "Clean wheel studs and hub face detail after wheel removal", "Wheel studs cleaned", "generated"),
    asset("auto_services", "auto_services_ai_tire_delivery_staging", "/generated-site-assets/auto-services/tire-delivery-staging-v1.png", "Unbranded tires staged on a plain dolly for tire delivery or installation", "Tire delivery staging", "generated"),
    asset("auto_services", "auto_services_ai_brake_rotor_inspection", "/generated-site-assets/auto-services/brake-rotor-inspection-v1.png", "Brake rotor and caliper assembly illuminated by an inspection light", "Brake rotor inspection", "generated"),
    asset("auto_services", "auto_services_ai_brake_pad_thickness", "/generated-site-assets/auto-services/brake-pad-thickness-v1.png", "Brake pad thickness comparison on a plain work mat without scale digits", "Brake pad thickness", "generated"),
    asset("auto_services", "auto_services_ai_brake_caliper_compression", "/generated-site-assets/auto-services/brake-caliper-compression-v1.png", "Caliper compression tool correctly seated on a brake caliper piston", "Caliper compression", "generated"),
    asset("auto_services", "auto_services_ai_brake_hardware_kit", "/generated-site-assets/auto-services/brake-hardware-kit-v1.png", "Unbranded brake clips springs and guide pins arranged on a plain work mat", "Brake hardware kit", "generated"),
    asset("auto_services", "auto_services_ai_brake_fluid_reservoir", "/generated-site-assets/auto-services/brake-fluid-reservoir-v1.png", "Brake fluid reservoir cap area crop with no readable labels", "Brake fluid reservoir", "generated"),
    asset("auto_services", "auto_services_ai_brake_wheel_off_assembly", "/generated-site-assets/auto-services/brake-wheel-off-assembly-v1.png", "Generic vehicle corner with wheel removed and brake assembly visible", "Wheel-off brake assembly", "generated"),
    asset("auto_services", "auto_services_ai_oil_filter_bench", "/generated-site-assets/auto-services/oil-filter-bench-v1.png", "Unbranded oil filter and oil service tools on a worn workbench", "Oil filter bench", "generated"),
    asset("auto_services", "auto_services_ai_oil_drain_plug", "/generated-site-assets/auto-services/oil-drain-plug-v1.png", "Wrench seated on oil drain plug with clean drain pan below", "Oil drain plug", "generated"),
    asset("auto_services", "auto_services_ai_oil_funnel_engine_bay", "/generated-site-assets/auto-services/oil-funnel-engine-bay-v1.png", "Plain oil funnel seated in a generic engine bay with no product labels", "Oil funnel service", "generated"),
    asset("auto_services", "auto_services_ai_maintenance_cabin_filter", "/generated-site-assets/auto-services/maintenance-cabin-filter-v1.png", "Cabin air filter replacement detail in a generic vehicle interior", "Cabin filter replacement", "generated"),
    asset("auto_services", "auto_services_ai_maintenance_dipstick_rag", "/generated-site-assets/auto-services/maintenance-dipstick-rag-v1.png", "Fluid check with dipstick and shop rag in a generic engine bay", "Dipstick fluid check", "generated"),
    asset("auto_services", "auto_services_ai_maintenance_serpentine_belt", "/generated-site-assets/auto-services/maintenance-serpentine-belt-v1.png", "Serpentine belt and pulley inspection with small unbranded light", "Serpentine belt inspection", "generated"),
    asset("auto_services", "auto_services_ai_diagnostic_battery_terminal_cleaning", "/generated-site-assets/auto-services/diagnostic-battery-terminal-cleaning-v1.png", "Battery terminal cleaning close-up with plain wire brush", "Battery terminal cleaning", "generated"),
    asset("auto_services", "auto_services_ai_diagnostic_battery_clamp", "/generated-site-assets/auto-services/diagnostic-battery-clamp-v1.png", "Clean battery clamp and cable connection detail with no readable battery label", "Battery clamp detail", "generated"),
    asset("auto_services", "auto_services_ai_diagnostic_multimeter_leads", "/generated-site-assets/auto-services/diagnostic-multimeter-leads-v1.png", "Multimeter probes on battery terminal points with display turned away", "Battery test leads", "generated"),
    asset("auto_services", "auto_services_ai_diagnostic_obd_connector", "/generated-site-assets/auto-services/diagnostic-obd-connector-v1.png", "Diagnostic connector cable plugged into an under-dash port with no scan-tool screen", "Diagnostic connector", "generated"),
    asset("auto_services", "auto_services_ai_diagnostic_engine_inspection_light", "/generated-site-assets/auto-services/diagnostic-engine-inspection-light-v1.png", "Engine bay inspection light illuminating generic hoses and fasteners", "Engine inspection light", "generated"),
    asset("auto_services", "auto_services_ai_diagnostic_relay_parts_flat_lay", "/generated-site-assets/auto-services/diagnostic-relay-parts-flat-lay-v1.png", "Unlabeled automotive relay and electrical diagnostic parts on a work mat", "Electrical parts detail", "generated"),
    asset("auto_services", "auto_services_ai_alignment_sensor_clamp", "/generated-site-assets/auto-services/alignment-sensor-clamp-v1.png", "Wheel alignment clamp attached to an unbranded wheel with no screen or target board", "Alignment sensor clamp", "generated"),
    asset("auto_services", "auto_services_ai_alignment_tie_rod_adjustment", "/generated-site-assets/auto-services/alignment-tie-rod-adjustment-v1.png", "Tie rod adjustment tool correctly seated on steering linkage", "Tie rod adjustment", "generated"),
    asset("auto_services", "auto_services_ai_alignment_suspension_fastener", "/generated-site-assets/auto-services/alignment-suspension-fastener-v1.png", "Socket wrench seated on a suspension fastener near a control arm", "Suspension fastener", "generated"),
    asset("auto_services", "auto_services_ai_alignment_uneven_tire_wear", "/generated-site-assets/auto-services/alignment-uneven-tire-wear-v1.png", "Uneven tire wear macro showing an alignment-related tread pattern", "Uneven tire wear", "generated"),
    asset("auto_services", "auto_services_ai_alignment_control_arm_inspection", "/generated-site-assets/auto-services/alignment-control-arm-inspection-v1.png", "Control arm bushing and ball joint inspection with small shop light", "Control arm inspection", "generated"),
    asset("auto_services", "auto_services_ai_alignment_steering_component", "/generated-site-assets/auto-services/alignment-steering-component-v1.png", "Steering linkage and rack boot inspection detail in an anonymous service bay", "Steering component inspection", "generated"),
    asset("auto_services", "auto_services_ai_glass_chip_resin_injector", "/generated-site-assets/auto-services/glass-chip-resin-injector-v1.png", "Windshield chip resin injector bridge centered on a small rock chip", "Glass chip resin injector", "generated"),
    asset("auto_services", "auto_services_ai_glass_rock_chip_macro", "/generated-site-assets/auto-services/glass-rock-chip-macro-v1.png", "Small windshield rock chip macro with no before-after claim", "Rock chip macro", "generated"),
    asset("auto_services", "auto_services_ai_glass_staged_windshield", "/generated-site-assets/auto-services/glass-staged-windshield-v1.png", "Replacement windshield safely staged on a padded stand in an anonymous shop", "Staged windshield glass", "generated"),
    asset("auto_services", "auto_services_ai_glass_urethane_bead", "/generated-site-assets/auto-services/glass-urethane-bead-v1.png", "Windshield opening with smooth fresh urethane bead on the pinch weld", "Glass urethane bead", "generated"),
    asset("auto_services", "auto_services_ai_glass_suction_cup_handling", "/generated-site-assets/auto-services/glass-suction-cup-handling-v1.png", "Supported windshield glass with suction-cup handles and safe gloved hand placement", "Safe glass handling", "generated"),
    asset("auto_services", "auto_services_ai_glass_wiper_cowl_detail", "/generated-site-assets/auto-services/glass-wiper-cowl-detail-v1.png", "Lower windshield edge and wiper cowl inspection detail", "Wiper cowl detail", "generated"),
    asset("auto_services", "auto_services_ai_glass_side_window_regulator", "/generated-site-assets/auto-services/glass-side-window-regulator-v1.png", "Side door glass and window regulator track inside a generic door shell", "Side window regulator", "generated"),
    asset("auto_services", "auto_services_ai_glass_tool_tray", "/generated-site-assets/auto-services/glass-tool-tray-v1.png", "Unbranded auto glass tools arranged on a plain work mat", "Auto glass tool tray", "generated"),
    asset("auto_services", "auto_services_ai_glass_primer_pinch_weld", "/generated-site-assets/auto-services/glass-primer-pinch-weld-v1.png", "Primer applicator along a clean windshield pinch weld edge", "Glass primer detail", "generated"),
    asset("auto_services", "auto_services_ai_glass_rain_beads", "/generated-site-assets/auto-services/glass-rain-beads-v1.png", "Rain beads and water sheeting on clean windshield glass", "Rain bead glass texture", "generated"),
    asset("auto_services", "auto_services_ai_glass_tape_retention", "/generated-site-assets/auto-services/glass-tape-retention-v1.png", "Plain retention tape holding a newly set windshield edge at the roofline", "Windshield tape retention", "generated"),
    asset("auto_services", "auto_services_ai_glass_edge_seal", "/generated-site-assets/auto-services/glass-edge-seal-v1.png", "Replacement glass edge and seal material supported on a padded stand", "Glass edge seal", "generated"),
    asset("auto_services", "auto_services_ai_glass_removal_wire", "/generated-site-assets/auto-services/glass-removal-wire-v1.png", "Windshield removal wire along adhesive edge with safe tool placement", "Windshield removal wire", "generated"),
    asset("auto_services", "auto_services_ai_glass_setting_blocks", "/generated-site-assets/auto-services/glass-setting-blocks-v1.png", "Plain rubber windshield setting blocks on a lower pinch weld", "Windshield setting blocks", "generated"),
    asset("auto_services", "auto_services_ai_glass_quarter_window_seal_prep", "/generated-site-assets/auto-services/glass-quarter-window-seal-prep-v1.png", "Quarter window seal channel prepared in an unbranded vehicle body opening", "Quarter-window seal prep", "generated"),
    asset("auto_services", "auto_services_ai_glass_door_channel", "/generated-site-assets/auto-services/glass-door-channel-v1.png", "Door glass channel and run seal inspection detail inside a generic door", "Door glass channel", "generated"),
    asset("auto_services", "auto_services_ai_glass_chip_fill_inspection", "/generated-site-assets/auto-services/glass-chip-fill-inspection-v1.png", "Small repaired windshield chip fill inspected under soft shop light", "Chip fill inspection", "generated"),
    asset("auto_services", "auto_services_ai_glass_replacement_edge_stand", "/generated-site-assets/auto-services/glass-replacement-edge-stand-v1.png", "Replacement windshield edge and black frit band supported on a padded stand", "Replacement glass edge", "generated")
  ],
  beauty_salon: [
    asset("beauty_salon", "beauty_salon_hero", "https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&w=1600&q=80", "Nail polish service in a salon", "Nail service"),
    asset("beauty_salon", "beauty_salon_station", "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80", "Salon station prepared for hair service", "Salon station"),
    asset("beauty_salon", "beauty_salon_hair_detail", "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?auto=format&fit=crop&w=1200&q=80", "Close-up of styled hair color in a salon", "Hair color detail")
  ],
  med_spa: [
    asset("med_spa", "med_spa_hero", "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1600&q=80", "Calm treatment room prepared for a spa appointment", "Treatment environment")
  ],
  law_firm: [
    asset("law_firm", "law_firm_hero", "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1600&q=80", "Law office conference room prepared for a client meeting", "Authority setting"),
    asset("law_firm", "law_firm_documents", "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80", "Legal documents reviewed at a desk", "Document review"),
    asset("law_firm", "law_firm_consultation", "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1200&q=80", "Professional consultation across a table", "Consultation")
  ],
  dental: [
    asset("dental", "dental_hero", "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?auto=format&fit=crop&w=1600&q=80", "Modern dental treatment room with patient chair", "Clinical setting")
  ],
  home_services: [
    asset("home_services", "home_services_hero", "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1600&q=80", "Home service technician working on electrical equipment", "Service capability"),
    asset("home_services", "home_services_tools", "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=1200&q=80", "Professional tools arranged for home repair work", "Service tools"),
    asset("home_services", "home_services_interior_repair", "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1200&q=80", "Home repair work in progress inside a house", "In-home repair")
  ],
  fitness: [
    asset("fitness", "fitness_hero", "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1600&q=80", "Fitness studio with training equipment ready for class", "Training space")
  ],
  real_estate: [
    asset("real_estate", "real_estate_hero", "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1600&q=80", "Residential home exterior prepared for a listing", "Local property proof")
  ],
  landscaping: [
    asset("landscaping", "landscaping_hero", "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=1600&q=80", "Landscaped yard with trimmed lawn and garden beds", "Finished yard"),
    asset("landscaping", "landscaping_garden_work", "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=80", "Gardening tools and planting work in progress", "Garden work"),
    asset("landscaping", "landscaping_green_lawn", "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1200&q=80", "Green lawn and maintained landscape edge", "Lawn care")
  ],
  veterinary: [
    asset("veterinary", "veterinary_hero", "https://images.unsplash.com/photo-1576201836106-db1758fd1c97?auto=format&fit=crop&w=1600&q=80", "Veterinary exam room with pet care equipment", "Care environment")
  ],
  creative_studio: [
    asset("creative_studio", "creative_studio_hero", "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1600&q=80", "Creative studio workspace with camera and production tools", "Studio capability"),
    asset("creative_studio", "creative_studio_camera", "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=80", "Camera and lighting setup for portrait photography and commercial shoots", "Portrait and commercial shoots"),
    asset("creative_studio", "creative_studio_workspace", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80", "Creative workspace prepared for production", "Production workspace")
  ],
  general_local: [
    asset("general_local", "general_local_hero", "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=80", "Customer conversation in a professional local business setting", "Customer conversation"),
    asset("general_local", "general_local_interior", "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80", "Clean business interior with workstations", "Trust-building space")
  ]
};

export function imageAssetsForVertical(vertical: Vertical) {
  return registry[vertical]?.length ? registry[vertical] : registry.general_local;
}

export function heroImageAssetForVertical(vertical: Vertical) {
  return imageAssetsForVertical(vertical)[0] ?? registry.general_local[0];
}

export function heroImageAssetForBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">) {
  if (business.vertical === "auto_body") {
    const terms = imageContextTerms([business.name, ...business.categories, ...business.services]);
    const assets = imageAssetsForVertical("auto_body");
    const preferredHeroIds: Array<{ terms: string[]; id: string }> = [
      { terms: ["glass", "windshield"], id: "auto_body_ai_windshield_replacement" },
      { terms: ["window"], id: "auto_body_ai_side_window_regulator" },
      { terms: ["hail"], id: "auto_body_ai_hail_hood_reflection" },
      { terms: ["dent", "pdr", "paintless"], id: "auto_body_ai_pdr_reflection_panel" },
      { terms: ["frame", "structural", "measure"], id: "auto_body_ai_frame_bench_measure" },
      { terms: ["paint", "refinish"], id: "auto_body_ai_paint_booth_masked_panel" },
      { terms: ["bumper"], id: "auto_body_ai_collision_disassembly" },
      { terms: ["scratch", "scuff", "rocker"], id: "auto_body_ai_rocker_scuff_repair" },
      { terms: ["pickup", "truck"], id: "auto_body_ai_pickup_bedside_prep" },
      { terms: ["collision", "repair"], id: "auto_body_ai_lift_bay_overview_hero" }
    ];
    for (const preference of preferredHeroIds) {
      if (!preference.terms.some((term) => terms.has(term))) continue;
      const asset = assets.find((candidate) => candidate.id === preference.id);
      if (asset) return asset;
    }
  }
  if (business.vertical === "auto_services") {
    const terms = imageContextTerms([business.name, ...business.categories, ...business.services]);
    const assets = imageAssetsForVertical("auto_services");
    const preferredHeroIds: Array<{ terms: string[]; id: string }> = [
      { terms: ["glass", "windshield", "window"], id: "auto_services_ai_glass_staged_windshield" },
      { terms: ["chip"], id: "auto_services_ai_glass_chip_resin_injector" },
      { terms: ["flat", "patch", "plug", "puncture"], id: "auto_services_ai_tire_interior_patch" },
      { terms: ["tpms", "pressure"], id: "auto_services_ai_tire_tpms_flat_lay" },
      { terms: ["tire", "used", "new", "rotation"], id: "auto_services_ai_env_tire_inventory_wall" },
      { terms: ["balance", "balancing"], id: "auto_services_ai_tire_wheel_balancing_spindle" },
      { terms: ["brake", "pad", "rotor"], id: "auto_services_ai_env_wheel_off_rotor_bay" },
      { terms: ["oil", "fluid", "filter"], id: "auto_services_ai_env_quick_lube_bay" },
      { terms: ["diagnostic", "battery", "electrical"], id: "auto_services_ai_env_battery_diagnostic_bay" },
      { terms: ["alignment", "suspension", "steering"], id: "auto_services_ai_env_alignment_rack" },
      { terms: ["mechanic", "vehicle", "repair"], id: "auto_services_ai_env_two_post_lift_bay" }
    ];
    for (const preference of preferredHeroIds) {
      if (!preference.terms.some((term) => terms.has(term))) continue;
      const asset = assets.find((candidate) => candidate.id === preference.id);
      if (asset) return asset;
    }
  }
  return rankedAssetsForBusiness(business)[0] ?? heroImageAssetForVertical(business.vertical);
}

export function galleryImageAssetsForVertical(vertical: Vertical) {
  const assets = imageAssetsForVertical(vertical);
  const fallback = registry.general_local;
  if (vertical !== "general_local" && assets.length >= 3) return assets.slice(0, 3);
  return [...assets, ...fallback].slice(0, 3);
}

export function galleryImageAssetsForBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">, limit = 3) {
  const assets = rankedAssetsForBusiness(business);
  if (business.vertical !== "general_local" && assets.length >= limit) return assets.slice(0, limit);
  return [...assets, ...registry.general_local].slice(0, limit);
}

export function registryAssetByUrl(url: string | undefined) {
  if (!url) return undefined;
  return Object.values(registry)
    .flat()
    .find((candidate) => candidate.url === url);
}

export function verticalImageRegistryCoverage() {
  return Object.fromEntries(Object.entries(registry).map(([vertical, assets]) => [vertical, assets.length]));
}

function asset(vertical: Vertical, id: string, url: string, alt: string, label: string, source: AssetReference["source"] = "licensed"): RegistryImageAsset {
  return {
    id,
    vertical,
    url,
    alt,
    label,
    source,
    rightsStatus: "preclaim_safe",
    usageScope: "preclaim_preview",
    width: 1600,
    height: 1000,
    licenseNote:
      source === "generated"
        ? "AI-generated category image for preview use. It is not a photo of this specific business, staff, vehicles, or customer work."
        : "Licensed stock source image. Verify and replace with customer-owned or generated slot-specific photography when available."
  };
}

function rankedAssetsForBusiness(business: Pick<BusinessProfile, "vertical" | "name" | "categories" | "services">) {
  const assets = imageAssetsForVertical(business.vertical);
  const terms = imageContextTerms([business.name, ...business.categories, ...business.services]);
  return assets
    .map((asset, index) => ({
      asset,
      index,
      score: imageAssetScore(asset, terms)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.asset);
}

function imageContextTerms(values: string[]) {
  const stopTerms = new Set([
    "a",
    "an",
    "and",
    "the",
    "for",
    "in",
    "near",
    "local",
    "business",
    "service",
    "services",
    "customer",
    "customers",
    "contact",
    "beauty",
    "salon",
    "restaurant",
    "cafe",
    "auto",
    "body",
    "home",
    "law",
    "firm"
  ]);
  return new Set(
    values
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
      .map((term) => term.replace(/s$/, ""))
      .filter((term) => term.length >= 3 && !stopTerms.has(term))
  );
}

function imageAssetScore(asset: RegistryImageAsset, terms: Set<string>) {
  const haystack = `${asset.label} ${asset.alt}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  let score = 0;
  for (const term of terms) {
    const singular = term.replace(/s$/, "");
    if (haystack.includes(term)) score += term.length >= 5 ? 4 : 2;
    if (singular !== term && haystack.includes(singular)) score += 2;
  }
  return score;
}
