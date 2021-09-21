/* eslint-disable react/prop-types */
import React from 'react';
import KML from 'ol/format/kml';
import GeoJSON from 'ol/format/geojson';
import _ from 'lodash';
import Immutable from 'immutable';
import Projection from 'ol/proj';
// import MultiPolygon from 'ol/geom/multipolygon';
import downloadjs from 'downloadjs';

// Material-Ui
import { FormGroup, FormControl, FormControlLabel, FormLabel, FormHelperText } from '@material-ui/core';
import Dialog from '@material-ui/core/Dialog';
import { withStyles } from '@material-ui/core/styles';
import DialogTitle from '@material-ui/core/DialogTitle';
import Select from '@material-ui/core/Select';
import MenuItem from '@material-ui/core/MenuItem';
import Input from '@material-ui/core/Input';
import FileUpload from '@material-ui/icons/FileUpload';
import Checkbox from '@material-ui/core/Checkbox';
import Grid from '@material-ui/core/Grid';
import Button from '@material-ui/core/Button';
import Tooltip from '@material-ui/core/Tooltip';

// import Typography from '@material-ui/core/Typography';
// import IconButton from '@material-ui/core/IconButton';
// import InputLabel from '@material-ui/core/InputLabel';
// import TextField from '@material-ui/core/TextField';
import { getMapStyle, convertTrailFeaturesToDonuts } from '../utils/mapUtils';
import { hexToRgb } from '../utils/convertToRGB';
import { Trail, Hydrant } from '../utils/records';
import OperationMessage from './OperationMessage';

const csvHeaders = ['Trail_Name', 'Hyd_ID', 'Hyd_Elevation', 'Hyd_Longitude', 'Hyd_Latitude'];
const legacyCsvHeaders = ['Trail_Name', 'Hyd_Index', 'Hyd_ID', 'Hyd_State', 'Hyd_Hours',
  'Hyd_Gun', 'Hyd_Gpm', 'Hyd_Notes', 'Hyd_Elevation',
  'Hyd_Target_Gallons', 'Hyd_Total_Gallons', 'Hyd_Cfm', 'Hyd_Pressure_Zone', 'Hyd_Longitude', 'Hyd_Latitude'];
const trailCsvHeaders = ['Trail_Name', 'Trail_Geo'];

const styles = theme => ({
  formControl: {
    marginTop: 10,
  },
  selectEmpty: {
    // marginTop: theme.spacing.unit * 2,
    marginTop: theme.spacing(2),
  },
});

class ImportExport extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      selectedFiles: null,
      // dialogOpen: false,
      selectedExport: 'trails',
      exportType: 'KML',
      excludeOrphans: true,
      message: null,
      exportName: 'trails',
      useLegacyCSV: false,
    };
    this.changeFile = this.changeFile.bind(this);
    this.importFile = this.importFile.bind(this);
  }

  changeFile(e) {
    this.setState({
      selectedFiles: e.target.files,
    });
  }

  importFile = () => {
    const { selectedFiles } = this.state;
    const { importKMLClicked, trails, hydrants } = this.props;
    function processTrail(feature, index) {
      // let [name, ...otherThings] = feature.get('description').split(',') ;
      let name;


      // if the feature already has a name, use that if not/derive it from description

      if (feature.get('name')) {
        name = feature.get('name');
      } else {
        // eslint-disable-next-line prefer-destructuring
        name = feature.get('description').split(',')[0];
      }
      // if (feature.get('description')){
      //   name = feature.get('description').split(',')[0] ;
      // } else {
      //   name = feature.get('name')
      // }

      const originalTrailName = name;
      name = _.words(name).join(' ');
      const coords = feature.getGeometry().getCoordinates()[0];
      const lonLatCoords = _.map(coords, pt => Projection.fromLonLat(pt.slice(0, 2)));

      const featureFill = feature.getStyle().call(feature)[0].getFill();

      let fillColor = '255,255,255';
      if (featureFill) {
        fillColor = hexToRgb(featureFill.getColor()) || featureFill.getColor().slice(0, 3).join(',');
      }

      feature.getGeometry().setCoordinates([lonLatCoords]);
      feature.setId(`t-${name}-${index}`);
      feature.set('originalTrailName', originalTrailName);
      feature.set('name', name);
      feature.set('fillColor', fillColor);
      feature.unset('selected');
      feature.changed();
      feature.setStyle(getMapStyle);

      return new Trail({ name, features: [feature], fillColor });
    }

    function processHydrant(feature, index) {
      let trailName,
        // eslint-disable-next-line no-unused-vars
        hydrantIndex,
        name,
        id;
      // Format is TrailName, hydrantIndex, hydrantName
      if (feature.get('description') && feature.get('description').split(',').length === 3) {
        [trailName, hydrantIndex, name] = feature.get('description').split(',');
        // Make Sure there are no hyphens in the name that gets included w/ the ID
        name = name.split('-').join('_');
        id = index + name;
      } else {
        id = new Date().getTime() + index;
        id = id.toString();
        name = `${index + 1}`;
      }

      if (feature.get('name')) {
        name = feature.get('name');
      }

      const originalTrailName = name;
      trailName = _.words(trailName).join(' ');
      const trailObj = trails.find(t => t.get('name') === trailName);
      const trailId = trailObj ? trailObj.get('id') : null;
      const geometry = feature.getGeometry().getType() === 'Point' ?
        feature.getGeometry() : feature.getGeometry().getGeometries()[0];
      feature.setGeometry(geometry);
      const coords = geometry.getCoordinates().slice(0, 2);
      feature.getGeometry().setCoordinates(Projection.fromLonLat(coords.slice(0, 2)));
      feature.setId(`h-${id}-${index}`);
      feature.set('originalTrailName', originalTrailName);
      feature.set('trailName', trailName);
      feature.setStyle(getMapStyle);
      return new Hydrant({
        id, name, coords, feature, trail: trailId,
      });
    }

    const reader = new FileReader();


    reader.onload = (event) => {
      try {
        const kml = new KML().readFeatures(event.target.result);
        const newTrails = {};
        const newHydrants = {};
        let type;
        // For Each Kml Feature determine type and call
        // corresponding process function
        _.each(kml, (feature, index) => {
          type = feature.getGeometry().getType() === 'Polygon' ? 'trail' : 'hydrant';
          if (type === 'trail') {
            let trail = processTrail(feature, index);
            const existing = newTrails[trail.get('name')];
            if (existing) {
              const newFeatures = existing.get('features').concat(trail.get('features')[0]);
              newTrails[existing.get('id')] = existing.set('features', newFeatures);
            } else {
              trail = trail.set('id', trail.get('name'));
              newTrails[trail.get('id')] = trail;
              hydrants
                .filter(h => h.get('feature').get('trailName') === trail.get('name'))
                .forEach((h) => {
                  newHydrants[h.get('id')] = h.set('trail', trail.get('id'));
                });
            }
          } else {
            const hydrant = processHydrant(feature, index);

            // Only Allow Hydrants With ids
            if (hydrant.get('id')) {
              newHydrants[hydrant.get('id')] = hydrant;
            }
          }
        });

        const newTrailSize = Object.keys(newTrails).length;
        const newHydrantSize = Object.keys(newHydrants).length;

        if (type === 'trail') {
          this.setState({
            message: `${newTrailSize} new Trails imported!`,
          });
        }

        if (type === 'hydrant') {
          this.setState({
            message: `${newHydrantSize} new Hydrants imported!`,
          });
        }

        importKMLClicked({
          trails: Immutable.Map(newTrails).map(t => convertTrailFeaturesToDonuts(t)),
          hydrants: Immutable.Map(newHydrants),
        });

        this.setState({ selectedFiles: null });
      } catch (err) {
        // Put error wherever we want to display error msgs.
        console.log(err);
      }
    };
    if (selectedFiles && selectedFiles.length) {
      reader.readAsText(selectedFiles[0]);
    }
  }

  exportFile = () => {
    const { trails, hydrants } = this.props;
    const { selectedExport, exportType, excludeOrphans } = this.state;

    const trailFeatures = [];
    const hydrantFeatures = [];


    if (!excludeOrphans) {
      _.chain(hydrants.toJS())
        .values()
        .filter({ trail: null })
        .value()
        .forEach((h) => {
          const { feature } = h;
          feature.unset('selected');
          hydrantFeatures.push(feature);
        });
    }
    trails
      .sortBy(a => a.get('name'))
      .valueSeq()
      .forEach((v, trailIndex) => {
        let trailName = v.get('name').split(' ').join('_');
        // Iterate through Trail's Features
        v.get('features').forEach((f, fIndex) => {
          if (f.get('originalTrailName') && !trailName) {
            trailName = f.get('originalTrailName');
          }
          const description = `${trailName},${trailIndex + fIndex + 1}`;
          f.unset('features');
          f.set('description', description);
          f.setStyle(getMapStyle);
          trailFeatures.push(f);
        });
        // Iterate through Trail's Hydrants
        _.chain(hydrants.toJS())
          .values()
          .filter({ trail: v.get('id') })
          .sort((a, b) => {
            if (a.name && b.name) {
              return a.name.localeCompare(b.name, undefined, { numeric: true });
            } else if (a.name && !b.name) {
              return 1;
            } else if (!a.name && b.name) {
              return -1;
            } else {
              return 0;
            }
          })
          .value()
          .forEach((h, index) => {
            const { feature } = h;
            // console.log(feature);
            // console.log(h.feature);
            feature.set('description', `${trailName},${index + 1},${feature.get('name')}`);
            feature.unset('selected');
            hydrantFeatures.push(feature);
          });
      });

    const ext = exportType === 'GJ' ? 'json' : 'kml';

    function getFileFromFeatures(features) {
      const format = exportType === 'GJ' ? new GeoJSON() : new KML();
      const exportFile = format.writeFeatures(features, { featureProjection: 'EPSG:3857' });
      return exportFile;
    }

    if (selectedExport === 'trails') {
      downloadjs(getFileFromFeatures(trailFeatures), `${this.state.exportName}.${ext}`);
    } else {
      downloadjs(getFileFromFeatures(hydrantFeatures), `${this.state.exportName}.${ext}`);
    }
  }

  generateCSV = () => {
    console.log('generateCSV');
    const trailGeo = {};
    const { hydrants, trails } = this.props;
    // console.log(trails);
    // console.log('Trails...');
    // console.log(trails);
    // console.log('Hydrants...');
    // console.log(hydrants);
    const hydrantsRows = [];
    const trailsRows = [];
    // Header Row Depends on whether we're exporting in legacy format or not
    hydrantsRows.push(this.state.useLegacyCSV ? [legacyCsvHeaders] : [csvHeaders]);
    trailsRows.push([trailCsvHeaders]);

    // console.log(trails);
    trails.keySeq().forEach((trailId) => {
      const trail = trails.get(trailId);
      let trailName = trail.get('name').split(' ').join('_');

      trail.get('features').forEach((feature) => {
        trailName = feature.get('originalTrailName') ? feature.get('originalTrailName') : trailName;
        // Build GeoJSON for trials - convert to Lat Lon
        // we need to clone it first so that we don't modify the original feature
        let featureCoords = feature.clone();
        featureCoords = featureCoords.getGeometry().transform('EPSG:3857', 'EPSG:4326');
        // console.log(trailCoords);
        if (trailGeo[trailName]) {
          trailGeo[trailName].push(featureCoords.getCoordinates()[0]);
        } else {
          trailGeo[trailName] = featureCoords.getCoordinates();
        }
        // trailGeo[trailName].push(featureCoords.getCoordinates());
        // End Build GeoJSON for Trails
        trailsRows.push([trailName, trailGeo[trailName]]);
      });


      const trailHydrants = _
        .chain(hydrants.toJS())
        .values()
        .filter({ trail: trailId })
        .sort((a, b) => {
          if (a.name && b.name) {
            return a.name.localeCompare(b.name, undefined, { numeric: true });
          } else if (a.name && !b.name) {
            return 1;
          } else if (!a.name && b.name) {
            return -1;
          } else {
            return 0;
          }
        })
        .value();

      if (this.state.useLegacyCSV) {
        for (let i = 0; i < 100; i += 1) {
          let hydId = i + 1;
          let elevation = 0;
          let longitude = 0;
          let latitude = 0;
          if (trailHydrants[i]) {
            hydId = trailHydrants[i].name;
            // eslint-disable-next-line prefer-destructuring
            elevation = trailHydrants[i].elevation;
            longitude = JSON.stringify(trailHydrants[i].coords[0] || 0);
            latitude = JSON.stringify(trailHydrants[i].coords[1] || 0);
          }
          hydrantsRows.push([
            trailName, i + 1, hydId, 0, 0,
            'None', 0, 'None', elevation, 0,
            0, 0, 'None', longitude, latitude,
          ]);
        }
      } else {
        trailHydrants.forEach((hydrant) => {
          // console.log(hydrant.coords);
          hydrantsRows.push([
            trailName,
            hydrant.name,
            hydrant.elevation || 0,
            JSON.stringify(hydrant.coords[0] || 0),
            JSON.stringify(hydrant.coords[1] || 0),
          ]);
        });
      }
    //  console.log(trailGeo[trailName]);
    // console.log(hydrantsRows);
    // console.log(trailGeo);
    });

    // Download the Hydrant CSV
    const lineArray = [];
    hydrantsRows.forEach((r, i) => {
      const line = r.join(',');
      lineArray.push(i === 0 ? `data:text/csv;charset=utf-8,${line}` : line);
    });
    const csvContent = lineArray.join('\n');
    const encodedUri = encodeURI(csvContent);
    downloadjs(encodedUri, 'Hydrants_Table.csv');


    // Download Trail CSV
    const trailLineArray = [`data:text/csv;charset=utf-8,${trailCsvHeaders}`];
    Object.keys(trailGeo).forEach((key) => {
      // quotes are to prevent csv parser from separating values into new columns
      trailLineArray.push([key, `"${JSON.stringify(trailGeo[key])}"`]);
    });

    const trailCsvContent = trailLineArray.join('\n');
    const trailEncodedUri = encodeURI(trailCsvContent);
    downloadjs(trailEncodedUri, 'Trails_Table.csv');
  }

  handleSelect = (event) => {
    this.setState({
      selectedExport: event.target.value,
    });
  }

  render() {
    const { classes, setImportExportOpen, importExportOpen } = this.props;

    const { selectedExport, selectedFiles, message } = this.state;


    return (
      <div style={{ display: 'inline' }}>

        <OperationMessage
          setMessageToNull={() => { this.setState({ message: null }); }}
          message={message}
        />

        <Dialog onBackdropClick={() => setImportExportOpen(false)} open={importExportOpen} >
          <DialogTitle >Import Export</DialogTitle>

          <Grid container style={{ padding: 15 }}>
            <Grid item xs={6}>
              <FormControl className={classes.formControl}>
                <FormLabel>Import</FormLabel>
                <FormGroup>
                  <div style={{ width: '100%', paddingLeft: 10 }}>
                    <input
                      className={classes.input}
                      onChange={this.changeFile}
                      type="file"
                      accept=".kml"
                      id="file-upload"
                    />
                    <Input
                      value={selectedFiles && selectedFiles[0] ? selectedFiles[0].name : ''}
                    />
                    <label htmlFor="file-upload">
                      <Button
                        component="span"
                        color="primary"
                        // variant="raised"
                        variant="contained"
                        mini="true"
                      >
                        <FileUpload />
                      </Button>
                    </label>
                    <Button
                      onClick={this.importFile}
                      color="primary"
                    > Import
                    </Button>
                  </div>
                </FormGroup>
              </FormControl>
            </Grid>

            <Grid item xs={6}>

              <FormControl fullWidth className={classes.formControl}>
                <FormLabel> Export </FormLabel>
                <Select
                  value={this.state.selectedExport}
                  onChange={(e) => {
 this.setState({
                      selectedExport: e.target.value,
                      exportName: e.target.value,
                    });
}}
                >
                  <MenuItem value="trails">Trails</MenuItem>
                  <MenuItem value="hydrants">Hydrants</MenuItem>
                </Select>
                <FormHelperText> Layer </FormHelperText>
              </FormControl>
              <FormControl fullWidth className={classes.formControl}>

                <Select
                  value={this.state.exportType}
                  onChange={(e) => { this.setState({ exportType: e.target.value }); }}
                >
                  <MenuItem value="KML">KML</MenuItem>
                  <MenuItem value="GJ">GeoJson</MenuItem>
                </Select>
                <FormHelperText> Format </FormHelperText>
              </FormControl>

              <Grid style={{ marginTop: 15 }} item xs={6}>
                <FormControl>
                  <Input
                    id="export-name"
                    value={this.state.exportName}
                    onChange={(e) => { this.setState({ exportName: e.target.value }); }}
                  />
                  <FormHelperText>File Name </FormHelperText>
                </FormControl>
              </Grid>
              {/* </FormControl> */}

              {
              selectedExport === 'hydrants' ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={this.state.excludeOrphans}
                      onChange={() => { this.setState({ excludeOrphans: !this.state.excludeOrphans }); }}
                      color="primary"
                    />
                  }
                  label="Exclude Orphans"
                />
              ) : (null)
            }

              <Button color="primary" onClick={this.exportFile} > Export {this.state.exportType} </Button>
              <Button
                color="primary"
                onClick={this.generateCSV}
              >
                   Download Hydrants CSV
              </Button>
              <Tooltip title="Use Legacy CSV Format">
                <Checkbox
                  checked={this.state.useLegacyCSV}
                  onChange={() => { this.setState({ useLegacyCSV: !this.state.useLegacyCSV }); }}
                  color="primary"
                />
              </Tooltip>
            </Grid>
          </Grid>
        </Dialog>
      </div>
    );
  }
}

export default withStyles(styles)(ImportExport);
